
CREATE OR REPLACE FUNCTION public.sync_client_no_show_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'no_show' THEN
      UPDATE public.clients SET no_show_count = no_show_count + 1 WHERE id = NEW.client_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'no_show' AND OLD.status IS DISTINCT FROM 'no_show' THEN
      UPDATE public.clients SET no_show_count = no_show_count + 1 WHERE id = NEW.client_id;
    ELSIF OLD.status = 'no_show' AND NEW.status IS DISTINCT FROM 'no_show' THEN
      UPDATE public.clients SET no_show_count = GREATEST(no_show_count - 1, 0) WHERE id = OLD.client_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'no_show' THEN
      UPDATE public.clients SET no_show_count = GREATEST(no_show_count - 1, 0) WHERE id = OLD.client_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS appointments_sync_no_show_count ON public.appointments;
CREATE TRIGGER appointments_sync_no_show_count
AFTER INSERT OR UPDATE OF status OR DELETE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.sync_client_no_show_count();

CREATE TRIGGER update_clients_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
