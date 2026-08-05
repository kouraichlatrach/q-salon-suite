-- Fixes guard_brand_billing_columns, which applied cleanly and never once
-- blocked anything.
--
-- The bug, in one line: the previous version tested `current_user`, but the
-- function is SECURITY DEFINER, and inside a SECURITY DEFINER function
-- `current_user` is the FUNCTION'S OWNER — not the caller. Supabase applies
-- migrations as `postgres`, so the function is owned by `postgres`, so
-- `current_user` evaluated to 'postgres' on every single invocation:
--
--     OR current_user IN ('postgres', 'service_role', 'supabase_admin')
--
-- That clause was therefore unconditionally true and the guard returned NEW
-- for everybody. A signed-in Owner could still raise their own max_locations
-- to 999 — verified against the linked project, which is how this was found.
--
-- The intent was "which role is connecting". SECURITY DEFINER is precisely the
-- mechanism that stops `current_user` meaning that, so the check has to come
-- from somewhere DEFINER cannot rewrite: the request's own JWT.
--
-- Exemptions after this change, and why each still holds:
--   * migrations / superuser — no PostgREST request, so no jwt claims and
--     auth.uid() is NULL.
--   * service_role — its key is a JWT carrying role 'service_role' with no
--     `sub`, so auth.uid() is NULL too. The explicit claim test is
--     belt-and-braces in case a service-role token ever carries a subject.
--   * platform admins — matched by identity via is_platform_admin(), which
--     cannot be spoofed by a role name.
-- An Owner has a `sub`, is not a platform admin, and is not service_role, so
-- they now fail all three and get blocked.
--
-- DO NOT reintroduce current_user / session_user here. session_user is no
-- better: PostgREST connects as `authenticator` and then SETs the role, so
-- session_user is 'authenticator' for authenticated and service_role alike
-- and cannot tell them apart either.

CREATE OR REPLACE FUNCTION public.guard_brand_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Read from the request JWT rather than the session role. `true` makes the
  -- setting optional, so this is NULL (not an error) outside a PostgREST
  -- request; NULL::jsonb ->> 'role' is NULL, and coalesce makes it ''.
  v_jwt_role text := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );
BEGIN
  IF auth.uid() IS NULL
     OR v_jwt_role = 'service_role'
     OR public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.plan                IS DISTINCT FROM OLD.plan
     OR NEW.max_locations       IS DISTINCT FROM OLD.max_locations
     OR NEW.max_staff_accounts  IS DISTINCT FROM OLD.max_staff_accounts
     OR NEW.addon_locations     IS DISTINCT FROM OLD.addon_locations
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.billing_cycle       IS DISTINCT FROM OLD.billing_cycle
     OR NEW.renewal_date        IS DISTINCT FROM OLD.renewal_date THEN
    RAISE EXCEPTION
      'Plan, limits and billing dates are set by Q-Salon Suite, not from the app. Contact us to change your plan.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

-- Re-assert the attachment. CREATE OR REPLACE FUNCTION leaves the existing
-- trigger pointing at the new body, so this is belt-and-braces against a
-- database where the earlier migration's CREATE TRIGGER was somehow lost.
DROP TRIGGER IF EXISTS guard_brand_billing_columns_trg ON public.brands;
CREATE TRIGGER guard_brand_billing_columns_trg
BEFORE UPDATE ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.guard_brand_billing_columns();
