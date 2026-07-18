
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill existing profiles from auth.users
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id AND p.email IS NULL;

-- Update handle_new_user to also store email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END; $$;

-- Allow brand members (owner/manager) to view profiles of teammates in same brand
DROP POLICY IF EXISTS "Brand members view teammate profiles" ON public.profiles;
CREATE POLICY "Brand members view teammate profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur_me
      JOIN public.user_roles ur_them ON ur_them.brand_id = ur_me.brand_id
      WHERE ur_me.user_id = auth.uid()
        AND ur_me.role IN ('owner','manager')
        AND ur_them.user_id = profiles.id
    )
  );
