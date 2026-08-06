-- Staff profiles: personal details (sensitive PII), photos, and location history.
--
-- Three tables rather than one, and the split is forced rather than stylistic.
--
-- THE PHOTO SPLIT. The brief asked for photo_url to sit on staff_personal_details
-- and be readable brand-wide while the rest of the row stays restricted to
-- Owner/Manager. Postgres cannot express that: RLS filters ROWS, never COLUMNS —
-- Section 4 bug class 10, found on `brands` during the plan restructure. A SELECT
-- policy grants the entire row or none of it. Column-level GRANTs exist but are
-- per-database-role (`authenticated`), not per-caller-condition, so they cannot
-- say "Owners see all columns, everyone else sees one". A single table would
-- therefore have meant choosing between hiding the photo from the people who
-- need it or exposing national_id and home_address to the whole brand. The photo
-- lives in its own table instead.
--
-- MANAGER SCOPE, DELIBERATELY TIGHTER THAN THE BRIEF. The brief said
-- "Owner/Manager of that staff member's brand". Brand-scoping Managers on a
-- multi-location brand means the Manager of Al Sadd can read the QID, home
-- address and date of birth of a stylist at Msheireb they have never met.
-- Qatar's PDPPL is a data-minimisation regime and this table is the most
-- sensitive in the product, so Manager access is scoped to their own location's
-- staff and Owner access stays brand-wide. Loosening this later is a one-line
-- change to can_view_staff_pii(); the reverse — discovering it was too broad
-- after a real salon's staff records are in it — is not.

-- ---------------------------------------------------------------------------
-- Who may see a staff member's PII? One function, so the four policies and the
-- UI cannot drift apart on the answer.
--
-- SECURITY DEFINER because it reads user_roles, which is RLS-protected: an
-- invoker-rights lookup would return nothing for the very callers it is meant
-- to authorise. It takes the actor as an argument and every policy passes
-- auth.uid(); it never consults current_user or session_user, both of which are
-- meaningless inside SECURITY DEFINER here (bug class 12 — a guard that reads
-- current_user exempts everybody and looks exactly like one that works).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_view_staff_pii(_actor uuid, _staff_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles staff
    JOIN public.user_roles actor
      ON actor.brand_id = staff.brand_id
     AND actor.user_id  = _actor
    WHERE staff.user_id = _staff_user_id
      AND (
        -- Owner: anyone in their brand.
        actor.role = 'owner'
        -- Manager: only staff sharing their location. A NULL location on either
        -- side must never match, or a Manager would reach brand-wide through a
        -- row that simply has no location set.
        OR (
          actor.role = 'manager'
          AND actor.location_id IS NOT NULL
          AND staff.location_id IS NOT NULL
          AND actor.location_id = staff.location_id
        )
      )
  );
$$;

COMMENT ON FUNCTION public.can_view_staff_pii IS
  'May _actor see _staff_user_id''s personal details? Owner: brand-wide. Manager: own location only. Receptionist and Staff: never. Deliberately tighter than the brand-member pattern used elsewhere — this table holds national ID and home address.';

REVOKE ALL ON FUNCTION public.can_view_staff_pii(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_staff_pii(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- staff_personal_details — the sensitive tier
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_personal_details (
  user_id                 uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  date_of_birth           date,
  national_id             text,
  home_address            text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  nationality             text,
  hire_date               date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_personal_details IS
  'Sensitive staff PII (QID, home address, DOB). Owner brand-wide, Manager own-location only. No photo here on purpose — see staff_photos.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_personal_details TO authenticated;
GRANT ALL ON public.staff_personal_details TO service_role;
ALTER TABLE public.staff_personal_details ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_staff_personal_details_updated_at
  BEFORE UPDATE ON public.staff_personal_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Four separate policies rather than FOR ALL: an over-broad USING on a FOR ALL
-- policy silently grants DELETE too, and this is not a table to be casual about.
DROP POLICY IF EXISTS "PII visible to owner and own-location manager" ON public.staff_personal_details;
CREATE POLICY "PII visible to owner and own-location manager"
  ON public.staff_personal_details FOR SELECT TO authenticated
  USING (public.can_view_staff_pii(auth.uid(), user_id));

DROP POLICY IF EXISTS "PII insertable by owner and own-location manager" ON public.staff_personal_details;
CREATE POLICY "PII insertable by owner and own-location manager"
  ON public.staff_personal_details FOR INSERT TO authenticated
  WITH CHECK (public.can_view_staff_pii(auth.uid(), user_id));

DROP POLICY IF EXISTS "PII updatable by owner and own-location manager" ON public.staff_personal_details;
CREATE POLICY "PII updatable by owner and own-location manager"
  ON public.staff_personal_details FOR UPDATE TO authenticated
  USING (public.can_view_staff_pii(auth.uid(), user_id))
  WITH CHECK (public.can_view_staff_pii(auth.uid(), user_id));

DROP POLICY IF EXISTS "PII deletable by owner and own-location manager" ON public.staff_personal_details;
CREATE POLICY "PII deletable by owner and own-location manager"
  ON public.staff_personal_details FOR DELETE TO authenticated
  USING (public.can_view_staff_pii(auth.uid(), user_id));

-- ---------------------------------------------------------------------------
-- staff_photos — the brand-wide tier
--
-- photo_path, not photo_url. The bucket is private, so the only thing a URL
-- could be is a signed URL, and a signed URL expires: storing one in a table
-- means storing a value that is wrong within the hour and stale forever after.
-- The stable fact is the object path; the client mints a short-lived signed URL
-- from it at render time.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_photos (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_id   uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  photo_path text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.staff_photos.photo_path IS
  'Object path inside the private staff-photos bucket, shaped {brand_id}/{user_id}. Not a URL: signed URLs expire, so persisting one would persist a value that stops working.';

CREATE INDEX IF NOT EXISTS staff_photos_brand_idx ON public.staff_photos(brand_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_photos TO authenticated;
GRANT ALL ON public.staff_photos TO service_role;
ALTER TABLE public.staff_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Brand members view staff photos" ON public.staff_photos;
CREATE POLICY "Brand members view staff photos"
  ON public.staff_photos FOR SELECT TO authenticated
  USING (public.is_brand_member(auth.uid(), brand_id));

DROP POLICY IF EXISTS "Owner and manager manage staff photos" ON public.staff_photos;
CREATE POLICY "Owner and manager manage staff photos"
  ON public.staff_photos FOR ALL TO authenticated
  USING (public.is_brand_manager_or_owner(auth.uid(), brand_id))
  WITH CHECK (public.is_brand_manager_or_owner(auth.uid(), brand_id));

-- ---------------------------------------------------------------------------
-- staff_location_history — append-mostly record of where someone has worked
--
-- ended_at IS NULL means "current". Exactly one open row per (user, brand) is
-- enforced by a partial unique index rather than by convention: two open rows
-- would make "where does this person work?" ambiguous, and the transfer RPC
-- closes "the" open row by that assumption.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_location_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_location_history_period_valid
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_location_history_one_open
  ON public.staff_location_history (user_id, brand_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_location_history_user_idx
  ON public.staff_location_history (user_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_location_history TO authenticated;
GRANT ALL ON public.staff_location_history TO service_role;
ALTER TABLE public.staff_location_history ENABLE ROW LEVEL SECURITY;

-- Audience per the brief: the same people who can see a staff member's
-- schedule, i.e. Owner/Manager of the relevant brand/location — plus the staff
-- member themselves, matching the existing "Own schedule visible" policy on
-- staff_schedules. Note this is narrower than that policy actually is:
-- can_manage_location() also admits Receptionists, and the brief named
-- Owner/Manager, so Receptionists are excluded here.
DROP POLICY IF EXISTS "Location history visible to owner, manager and self" ON public.staff_location_history;
CREATE POLICY "Location history visible to owner, manager and self"
  ON public.staff_location_history FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_brand_owner(auth.uid(), brand_id)
    OR (
      public.has_role(auth.uid(), 'manager')
      AND public.has_location_access(auth.uid(), location_id)
    )
  );

-- No INSERT/UPDATE/DELETE policy, deliberately. Every write goes through
-- transfer_staff_location(), which is SECURITY DEFINER and keeps the history
-- row and user_roles.location_id in step. A direct client write could set one
-- without the other, which is precisely the split-brain this table exists to
-- prevent (bug class 3). Nothing here is reachable by `authenticated` for write
-- even though the GRANT exists, because RLS denies by default.
