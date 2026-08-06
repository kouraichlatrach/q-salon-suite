-- Storage bucket for staff photos. First use of Supabase Storage in this
-- project, so the reasoning is written down rather than assumed.
--
-- PRIVATE, NOT PUBLIC. A public bucket serves every object to anyone who knows
-- or guesses the URL, with no auth check at all — the brief asks for photos
-- readable by brand members, which is an authorisation rule, and a public bucket
-- cannot express one. Private + RLS on storage.objects + short-lived signed URLs
-- is the only shape that actually enforces it.
--
-- PATH CONVENTION: {brand_id}/{user_id}. The brand has to be the FIRST segment
-- because that is the only part of the path the policies can cheaply parse
-- (storage.foldername(name))[1]. Putting the user first would leave the policy
-- unable to answer "which brand does this object belong to?" without a lookup
-- on every row.
--
-- The policies below authorise on the PATH, not on staff_photos. That is
-- deliberate: the table row is written after a successful upload, so a policy
-- that depended on it could not authorise the upload that creates it.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-photos',
  'staff-photos',
  false,
  5242880,                                   -- 5 MB; a portrait needs nowhere near this
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,                        -- never let this drift to public
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read: any member of the brand whose id is the first path segment. This is the
-- brand-wide tier the brief asked for — the photo is the one piece of a staff
-- profile everyone at the salon legitimately needs to recognise a colleague.
DROP POLICY IF EXISTS "Brand members read staff photos" ON storage.objects;
CREATE POLICY "Brand members read staff photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-photos'
    AND public.is_brand_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- Write: Owner/Manager of that brand only, on all three mutating verbs.
-- INSERT and UPDATE are separated because UPDATE needs both USING (which row may
-- be replaced) and WITH CHECK (what it may be replaced with); collapsing them
-- into FOR ALL would also hand out DELETE via the same USING clause without
-- that being visible at the call site.
DROP POLICY IF EXISTS "Owner and manager upload staff photos" ON storage.objects;
CREATE POLICY "Owner and manager upload staff photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'staff-photos'
    AND public.is_brand_manager_or_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Owner and manager replace staff photos" ON storage.objects;
CREATE POLICY "Owner and manager replace staff photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'staff-photos'
    AND public.is_brand_manager_or_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'staff-photos'
    AND public.is_brand_manager_or_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Owner and manager delete staff photos" ON storage.objects;
CREATE POLICY "Owner and manager delete staff photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'staff-photos'
    AND public.is_brand_manager_or_owner(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
