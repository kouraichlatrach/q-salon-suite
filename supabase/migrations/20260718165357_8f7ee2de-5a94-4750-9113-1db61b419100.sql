
-- Prevent staff double-booking at DB level
CREATE OR REPLACE FUNCTION public.prevent_appointment_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'Appointment end time must be after start time' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.staff_user_id = NEW.staff_user_id
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.status <> 'cancelled'
      AND a.starts_at < NEW.ends_at
      AND a.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Staff member already has an overlapping appointment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_appointment_overlap ON public.appointments;
CREATE TRIGGER trg_prevent_appointment_overlap
BEFORE INSERT OR UPDATE OF starts_at, ends_at, staff_user_id, status
ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.prevent_appointment_overlap();

-- Unique schedule row per staff/location/day
CREATE UNIQUE INDEX IF NOT EXISTS staff_schedules_user_location_day_uniq
  ON public.staff_schedules (user_id, location_id, day_of_week);

-- updated_at trigger for appointments and service_records
DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_service_records_updated_at ON public.service_records;
CREATE TRIGGER trg_service_records_updated_at
BEFORE UPDATE ON public.service_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure the no-show sync trigger is attached (was defined but might not be wired)
DROP TRIGGER IF EXISTS trg_sync_client_no_show ON public.appointments;
CREATE TRIGGER trg_sync_client_no_show
AFTER INSERT OR UPDATE OR DELETE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.sync_client_no_show_count();
