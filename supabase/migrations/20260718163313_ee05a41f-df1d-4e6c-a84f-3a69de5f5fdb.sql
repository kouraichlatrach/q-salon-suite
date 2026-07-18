
-- 1. Schema changes to user_roles
ALTER TABLE public.user_roles
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS invited_email TEXT;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_or_invite_chk;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_or_invite_chk
  CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_pending_invite_unique
  ON public.user_roles (brand_id, lower(invited_email))
  WHERE user_id IS NULL AND invited_email IS NOT NULL;

-- 2. Plan-limit trigger
CREATE OR REPLACE FUNCTION public.enforce_staff_plan_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  max_allowed INT;
BEGIN
  SELECT max_staff_accounts INTO max_allowed FROM public.brands WHERE id = NEW.brand_id;
  IF max_allowed IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO current_count FROM public.user_roles WHERE brand_id = NEW.brand_id;
  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'Staff limit reached for this brand (max %). Upgrade your plan to add more.', max_allowed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_staff_plan_limit_trg ON public.user_roles;
CREATE TRIGGER enforce_staff_plan_limit_trg
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_plan_limit();

-- 3. Claim pending invite function (called from client right after signup)
CREATE OR REPLACE FUNCTION public.claim_pending_invite()
RETURNS SETOF public.user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.user_roles
     SET user_id = auth.uid(),
         invited_email = NULL
   WHERE user_id IS NULL
     AND lower(invited_email) = lower(v_email)
   RETURNING *;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_pending_invite() TO authenticated;

-- 4. Update RLS so pending invites are visible to those who created them
DROP POLICY IF EXISTS "Owners view role rows in brand" ON public.user_roles;
CREATE POLICY "Owners view role rows in brand"
  ON public.user_roles FOR SELECT
  USING (is_brand_owner(auth.uid(), brand_id));

DROP POLICY IF EXISTS "Managers view roles at their location" ON public.user_roles;
CREATE POLICY "Managers view roles at their location"
  ON public.user_roles FOR SELECT
  USING (
    location_id IS NOT NULL
    AND has_role(auth.uid(), 'manager'::app_role)
    AND has_location_access(auth.uid(), location_id)
  );
