CREATE OR REPLACE FUNCTION public.create_brand_with_owner_location(
  _brand_name text,
  _plan subscription_plan,
  _max_locations int,
  _max_staff_accounts int,
  _location_name text,
  _location_address text,
  _location_phone text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_brand uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.brands (
    owner_user_id, name, plan, subscription_status, billing_cycle,
    max_locations, max_staff_accounts
  ) VALUES (
    v_user, _brand_name, _plan, 'trial', 'monthly',
    _max_locations, _max_staff_accounts
  )
  RETURNING id INTO v_brand;

  INSERT INTO public.user_roles (user_id, role, brand_id, location_id)
  VALUES (v_user, 'owner', v_brand, NULL);

  INSERT INTO public.locations (brand_id, name, address, phone)
  VALUES (v_brand, _location_name, NULLIF(_location_address, ''), NULLIF(_location_phone, ''));

  RETURN v_brand;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_brand_with_owner_location(text, subscription_plan, int, int, text, text, text) TO authenticated;
