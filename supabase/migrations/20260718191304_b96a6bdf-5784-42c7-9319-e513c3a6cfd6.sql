
-- 1) Trigger to apply stock_movements to location_stock quantities
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delta NUMERIC;
BEGIN
  IF NEW.movement_type = 'restock' THEN
    delta := NEW.quantity;
  ELSE
    -- usage, waste, adjustment all reduce stock; adjustments can be negative quantity if needed
    delta := -NEW.quantity;
  END IF;

  INSERT INTO public.location_stock (location_id, product_id, quantity, low_stock_threshold)
  VALUES (NEW.location_id, NEW.product_id, 0, 0)
  ON CONFLICT (location_id, product_id) DO NOTHING;

  UPDATE public.location_stock
     SET quantity = quantity + delta,
         updated_at = now()
   WHERE location_id = NEW.location_id
     AND product_id = NEW.product_id;

  RETURN NEW;
END;
$$;

-- Ensure location_stock has a uniqueness constraint used above
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_stock_location_product_unique'
  ) THEN
    ALTER TABLE public.location_stock
      ADD CONSTRAINT location_stock_location_product_unique UNIQUE (location_id, product_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- updated_at trigger on location_stock if not present
DROP TRIGGER IF EXISTS trg_location_stock_updated_at ON public.location_stock;
CREATE TRIGGER trg_location_stock_updated_at
BEFORE UPDATE ON public.location_stock
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Auto-deduct stock on service_record_products insert
CREATE OR REPLACE FUNCTION public.auto_deduct_stock_on_service_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_technician UUID;
BEGIN
  SELECT a.location_id, sr.technician_user_id
    INTO v_location_id, v_technician
  FROM public.service_records sr
  JOIN public.appointments a ON a.id = sr.appointment_id
  WHERE sr.id = NEW.service_record_id;

  IF v_location_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_movements (location_id, product_id, movement_type, quantity, notes, created_by)
  VALUES (v_location_id, NEW.product_id, 'usage', NEW.quantity, 'Auto-deducted from service completion', v_technician);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_deduct_stock ON public.service_record_products;
CREATE TRIGGER trg_auto_deduct_stock
AFTER INSERT ON public.service_record_products
FOR EACH ROW EXECUTE FUNCTION public.auto_deduct_stock_on_service_use();
