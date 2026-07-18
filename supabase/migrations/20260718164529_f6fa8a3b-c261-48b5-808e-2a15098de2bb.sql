
-- 1. Exclude owners from seat count
CREATE OR REPLACE FUNCTION public.enforce_staff_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  max_allowed INT;
BEGIN
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;
  SELECT max_staff_accounts INTO max_allowed FROM public.brands WHERE id = NEW.brand_id;
  IF max_allowed IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO current_count
    FROM public.user_roles
    WHERE brand_id = NEW.brand_id AND role <> 'owner';
  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'Staff limit reached for this brand (max %). Upgrade your plan to add more.', max_allowed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 2. Global uniqueness for pending invites (one pending invite per email, across all brands)
DROP INDEX IF EXISTS public.user_roles_pending_invite_unique;
CREATE UNIQUE INDEX user_roles_pending_invite_unique
  ON public.user_roles (lower(invited_email))
  WHERE user_id IS NULL AND invited_email IS NOT NULL;

-- 3. Defensive claim_pending_invite: refuse if the user already has a role in a different brand
CREATE OR REPLACE FUNCTION public.claim_pending_invite()
RETURNS SETOF user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_existing_brand UUID;
  v_pending_brand UUID;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  -- Does the caller already hold a role somewhere?
  SELECT brand_id INTO v_existing_brand
    FROM public.user_roles
    WHERE user_id = auth.uid()
    LIMIT 1;

  -- What brand is their pending invite for?
  SELECT brand_id INTO v_pending_brand
    FROM public.user_roles
    WHERE user_id IS NULL
      AND lower(invited_email) = lower(v_email)
    LIMIT 1;

  -- If they already belong to a different brand, refuse to claim.
  IF v_existing_brand IS NOT NULL
     AND v_pending_brand IS NOT NULL
     AND v_existing_brand <> v_pending_brand THEN
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
