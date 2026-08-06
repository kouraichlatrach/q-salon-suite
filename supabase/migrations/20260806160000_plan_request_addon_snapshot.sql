-- Snapshot the add-on count alongside the plan, so "has this been applied yet?"
-- can be answered honestly.
--
-- The request queue now shows the admin whether the brand already reflects what
-- was asked for. For a tier request that comparison is easy: does brands.plan
-- equal requested_plan? For an ADD-ON request it was not answerable at all —
-- the row said "+2 locations" but nothing recorded what the brand had at the
-- moment of asking, so "+2 applied" and "+2 still outstanding" looked identical
-- once any add-on existed.
--
-- Guessing there would be worse than saying nothing: a green "looks applied"
-- that is wrong is precisely the mis-signal this whole change set out to fix.
-- So the same BEFORE INSERT trigger that already stamps current_plan from the
-- brand now stamps current_addon_locations too. Same pattern, same trigger,
-- reads brands and writes nothing — not a new tracking mechanism, just the
-- existing snapshot made complete enough to compare against.
--
-- Backfill note: existing rows get 0, which is also the column default. That is
-- honest for the current data (no brand has add-ons yet) and, for any row where
-- it were wrong, errs toward "not applied" rather than a false green.

ALTER TABLE public.plan_upgrade_requests
  ADD COLUMN IF NOT EXISTS current_addon_locations int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plan_upgrade_requests.current_addon_locations IS
  'brands.addon_locations at the moment the request was raised. Stamped by trigger, never trusted from the client. Lets the admin queue compare requested_addon_locations_delta against what actually changed.';

CREATE OR REPLACE FUNCTION public.stamp_plan_request_current_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  SELECT b.plan, COALESCE(b.addon_locations, 0)
    INTO NEW.current_plan, NEW.current_addon_locations
  FROM public.brands b WHERE b.id = NEW.brand_id;

  IF NEW.current_plan IS NULL THEN
    RAISE EXCEPTION 'plan_request_unknown_brand: no brand %', NEW.brand_id;
  END IF;
  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.stamp_plan_request_current_plan IS
  'Stamps current_plan and current_addon_locations onto a new request from the brand row. Reads brands; writes nothing to it — that separation is what keeps plan_upgrade_requests from becoming a second, unguarded path to the billing columns.';
