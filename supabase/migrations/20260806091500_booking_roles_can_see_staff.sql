-- Let the people who book appointments actually see the staff they may book.
--
-- Found while restricting bookable staff to role='staff'. The internal picker
-- reads user_roles + profiles directly under RLS, and the SELECT policies on
-- both tables stop at Owner and Manager:
--
--   user_roles : "Users view own role rows"          (user_id = auth.uid())
--                "Owners view role rows in brand"
--                "Managers view roles at their location"
--   profiles   : "Users view own profile"
--                "Brand members view teammate profiles"  (owner/manager only)
--
-- A Receptionist matches none of those except their own row. Before this work
-- that was masked: the picker filtered on `role = 'owner' OR location matches`,
-- and the single row RLS returned to a Receptionist was their own, at their own
-- location — so the dropdown listed exactly one option, themselves, and the
-- Receptionist booked every appointment against a Receptionist account. That is
-- a substantial share of the non-Staff assignments this migration's sibling
-- cleans up; the missing policy is where they came from.
--
-- Filtering the picker to role='staff' without this policy would turn "wrongly
-- shows only me" into "shows nobody" — a Receptionist could not book at all.
-- Neither is acceptable, so the read access is granted here, narrowly.
--
-- Scope, deliberately tight: these policies expose ONLY staff-role rows, and
-- only at a location the caller already administers. A Receptionist still
-- cannot enumerate Owners, Managers, other Receptionists, or anyone at a
-- location they have no access to. can_manage_location() is the existing
-- owner/manager/receptionist test and is SECURITY DEFINER, so referencing it
-- inside a user_roles policy reads the table without re-entering RLS — no
-- policy recursion.

DROP POLICY IF EXISTS "Booking roles view staff at their location" ON public.user_roles;
CREATE POLICY "Booking roles view staff at their location"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    role = 'staff'
    AND location_id IS NOT NULL
    AND public.can_manage_location(auth.uid(), location_id)
  );

DROP POLICY IF EXISTS "Booking roles view staff profiles" ON public.profiles;
CREATE POLICY "Booking roles view staff profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = profiles.id
        AND ur.role = 'staff'
        AND ur.location_id IS NOT NULL
        AND public.can_manage_location(auth.uid(), ur.location_id)
    )
  );
