
CREATE OR REPLACE FUNCTION public.email_has_other_brand_account(_email text, _brand uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE lower(p.email) = lower(_email)
      AND ur.brand_id <> _brand
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id IS NULL
      AND lower(ur.invited_email) = lower(_email)
      AND ur.brand_id <> _brand
  );
$$;

REVOKE ALL ON FUNCTION public.email_has_other_brand_account(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_has_other_brand_account(text, uuid) TO authenticated;
