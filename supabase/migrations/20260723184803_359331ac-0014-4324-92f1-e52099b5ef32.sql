CREATE OR REPLACE FUNCTION public.enforce_location_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  max_allowed INT;
BEGIN
  SELECT max_locations INTO max_allowed FROM public.brands WHERE id = NEW.brand_id;
  IF max_allowed IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO current_count FROM public.locations WHERE brand_id = NEW.brand_id;
  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'Location limit reached for this brand (max %). Upgrade your plan to add more.', max_allowed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_location_plan_limit_trigger ON public.locations;
CREATE TRIGGER enforce_location_plan_limit_trigger
BEFORE INSERT ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.enforce_location_plan_limit();