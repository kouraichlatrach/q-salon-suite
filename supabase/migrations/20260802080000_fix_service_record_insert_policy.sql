-- Fix: "Complete & log income" could never insert a service record.
--
-- PRE-EXISTING BUG, unrelated to gift cards — found while browser-testing the
-- gift card redemption flow, which runs through the same dialog.
--
-- The only INSERT policy on service_records was:
--
--   WITH CHECK (
--     technician_user_id = auth.uid()
--     AND EXISTS (SELECT 1 FROM appointments a
--                 WHERE a.id = appointment_id
--                   AND a.staff_user_id = auth.uid()
--                   AND a.status = 'completed')
--   )
--
-- Two conditions the completion flow cannot satisfy:
--
-- 1. `a.status = 'completed'` — CompleteDialog inserts the service record
--    *before* marking the appointment completed, so at insert time the status
--    is still 'scheduled'. The policy therefore required a state that only
--    exists after the very write it was gating. This failed for everyone,
--    including the assigned technician.
--
-- 2. `technician_user_id = auth.uid()` — the dialog writes the appointment's
--    assigned staff member as the technician, so an Owner, Manager or
--    Receptionist completing someone else's appointment was always rejected.
--    That is the normal front-desk case: reception checks the client out, not
--    the stylist.
--
-- Net effect: the checkout flow threw "new row violates row-level security
-- policy for table service_records" every time. Exactly the class of bug
-- Section 4 warns about — invisible to schema review and to type checking,
-- visible the moment the button is actually pressed in a browser.
--
-- The fix keeps the technician's own-record path, drops the impossible status
-- requirement, and adds the manager/reception path that the UI has always
-- assumed existed. Location scoping is still enforced in both branches, so
-- this widens who may write a record — never which salon's data they can reach.

DROP POLICY IF EXISTS "Technician logs own service record" ON public.service_records;

CREATE POLICY "Technician logs own service record" ON public.service_records
  FOR INSERT TO authenticated
  WITH CHECK (
    -- The technician recording their own work.
    (
      technician_user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = appointment_id AND a.staff_user_id = auth.uid()
      )
    )
    -- Or whoever runs the front desk for that location, which is who actually
    -- completes appointments in practice.
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id
        AND public.can_manage_location(auth.uid(), a.location_id)
    )
  );
