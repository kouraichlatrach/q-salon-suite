-- transfer_staff_location — move a staff member between locations, atomically.
--
-- Three writes have to agree or the product lies about where someone works:
--   1. close the open staff_location_history row (ended_at = now())
--   2. open a new one at the new location
--   3. point user_roles.location_id at the new location
--
-- Doing that as three client-side calls is bug class 3 (multi-step writes need
-- one exception scope). A network drop between 2 and 3 would leave the history
-- claiming a transfer that the roster disagrees with, and nothing would ever
-- reconcile them. One SECURITY DEFINER function, one transaction.
--
-- Authorisation is decided from auth.uid() and the caller's own user_roles rows.
-- current_user and session_user are both useless here: current_user is the
-- function owner inside SECURITY DEFINER, and session_user is `authenticator`
-- for every PostgREST caller regardless of role (bug class 12). A guard built on
-- either would exempt everybody while looking correct.

CREATE OR REPLACE FUNCTION public.transfer_staff_location(
  _staff_user_id uuid,
  _new_location_id uuid
) RETURNS TABLE(ok boolean, outcome text, history_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor    uuid := auth.uid();
  v_brand    uuid;
  v_cur_loc  uuid;
  v_is_owner boolean;
  v_is_mgr   boolean;
  v_hist     uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, NULL::uuid; RETURN;
  END IF;

  -- Derive the brand from the destination rather than from the staff member.
  -- Doing it this way makes a cross-brand transfer impossible to express: if the
  -- target holds no staff role in the destination's brand, the next lookup
  -- simply finds nothing.
  SELECT l.brand_id INTO v_brand
  FROM public.locations l
  WHERE l.id = _new_location_id AND l.is_active = true;
  IF v_brand IS NULL THEN
    RETURN QUERY SELECT false, 'location_not_found'::text, NULL::uuid; RETURN;
  END IF;

  -- Serialise concurrent transfers of the same person before reading their
  -- current location. Without this, two managers pulling the same stylist at
  -- once could both read the old location and both write history rows — the
  -- read-then-write race of bug class 11, which the partial unique index would
  -- then reject with an opaque constraint error instead of a clean outcome.
  PERFORM pg_advisory_xact_lock(hashtextextended(_staff_user_id::text, 0));

  SELECT ur.location_id INTO v_cur_loc
  FROM public.user_roles ur
  WHERE ur.user_id = _staff_user_id
    AND ur.brand_id = v_brand
    AND ur.role = 'staff';
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_staff_in_brand'::text, NULL::uuid; RETURN;
  END IF;

  -- Owner: any location in the brand.
  -- Manager: only INTO a location they themselves manage. They may pull a
  -- stylist in from anywhere in the brand, but can never push one out to a
  -- location they do not run.
  v_is_owner := public.is_brand_owner(v_actor, v_brand);
  v_is_mgr := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_actor
      AND ur.brand_id = v_brand
      AND ur.role = 'manager'
      AND ur.location_id = _new_location_id
  );
  IF NOT (v_is_owner OR v_is_mgr) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;

  -- Already there. Returning early matters: closing and reopening the same
  -- location would write a zero-length stint into the history and make the
  -- timeline read as though something happened.
  IF v_cur_loc IS NOT DISTINCT FROM _new_location_id THEN
    RETURN QUERY SELECT false, 'no_change'::text, NULL::uuid; RETURN;
  END IF;

  UPDATE public.staff_location_history
     SET ended_at = now()
   WHERE user_id = _staff_user_id
     AND brand_id = v_brand
     AND ended_at IS NULL;

  INSERT INTO public.staff_location_history (user_id, location_id, brand_id, started_at)
  VALUES (_staff_user_id, _new_location_id, v_brand, now())
  RETURNING id INTO v_hist;

  UPDATE public.user_roles
     SET location_id = _new_location_id
   WHERE user_id = _staff_user_id
     AND brand_id = v_brand
     AND role = 'staff';

  RETURN QUERY SELECT true, 'transferred'::text, v_hist;
END $function$;

COMMENT ON FUNCTION public.transfer_staff_location IS
  'Atomically closes the open location-history row, opens a new one, and updates user_roles.location_id. Owner may target any location in the brand; Manager only a location they manage. Appointments are deliberately untouched — they carry their own location_id, so past work stays credited to where it happened.';

-- Callable by signed-in users: the function does its own authorisation from
-- auth.uid(). This matches gift_card_redeem, which is granted to `authenticated`
-- and relies on internal is_brand_member checks, rather than the public_*/
-- payment_* convention of service_role-only (those back unauthenticated flows).
REVOKE ALL ON FUNCTION public.transfer_staff_location(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_staff_location(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: give every current staff member an open history row.
--
-- Without this the timeline is blank until someone's first transfer, and the
-- RPC would open a new stint with nothing before it — the page would show a
-- stylist as having started at their second location.
--
-- started_at uses the role row's created_at, which is the closest thing to
-- truth available: we know when they were added to the brand, not when they
-- physically started. hire_date on staff_personal_details is the field for the
-- real answer once someone enters it.
-- ---------------------------------------------------------------------------

INSERT INTO public.staff_location_history (user_id, location_id, brand_id, started_at)
SELECT ur.user_id, ur.location_id, ur.brand_id, COALESCE(ur.created_at, now())
FROM public.user_roles ur
WHERE ur.role = 'staff'
  AND ur.user_id IS NOT NULL
  AND ur.location_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_history h
    WHERE h.user_id = ur.user_id
      AND h.brand_id = ur.brand_id
      AND h.ended_at IS NULL
  );
