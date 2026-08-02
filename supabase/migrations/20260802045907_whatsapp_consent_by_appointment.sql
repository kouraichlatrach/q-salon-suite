-- Consent capture at booking time.
--
-- The booking flows know the appointment, not the client id, so this resolves
-- one from the other. Consent is only ever *granted* here — a booking must
-- never silently revoke a standing preference the client set elsewhere, so an
-- unchecked box on a later booking leaves an existing opt-in untouched.
-- Revoking is a deliberate act: the staff toggle, or replying STOP.
CREATE OR REPLACE FUNCTION public.whatsapp_consent_from_booking(
  _appointment_id uuid, _opt_in boolean, _source public.consent_source
) RETURNS TABLE(client_id uuid, opted_in boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_client uuid; v_current boolean;
BEGIN
  SELECT a.client_id INTO v_client FROM public.appointments a WHERE a.id = _appointment_id;
  IF v_client IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false; RETURN;
  END IF;

  SELECT c.whatsapp_opt_in INTO v_current FROM public.clients c WHERE c.id = v_client;

  IF _opt_in AND NOT COALESCE(v_current,false) THEN
    UPDATE public.clients
    SET whatsapp_opt_in = true,
        whatsapp_opt_in_at = now(),
        whatsapp_consent_source = _source,
        updated_at = now()
    WHERE id = v_client;
    v_current := true;
  END IF;

  RETURN QUERY SELECT v_client, COALESCE(v_current,false);
END $function$;

REVOKE ALL ON FUNCTION public.whatsapp_consent_from_booking(uuid,boolean,public.consent_source) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_consent_from_booking(uuid,boolean,public.consent_source) TO service_role;
