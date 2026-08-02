-- WhatsApp Automation — RPC layer.
--
-- Same division as Payments: the database owns consent state and decides who is
-- eligible for a message; the Node layer only talks to the provider.

-- ---------------------------------------------------------------------------
-- Template resolution
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_get_template(_brand_id uuid, _kind text)
RETURNS TABLE(content_sid text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT t.content_sid, t.is_active
  FROM public.whatsapp_templates t
  WHERE t.brand_id = _brand_id AND t.kind = _kind
  LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- Audit log writer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_log_message(
  _brand_id uuid, _appointment_id uuid, _client_id uuid, _kind text,
  _to_phone text, _provider text, _provider_sid text, _status text,
  _error_message text, _body_preview text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.whatsapp_messages(
    brand_id, appointment_id, client_id, kind, to_phone,
    provider, provider_sid, status, error_message, body_preview)
  VALUES (_brand_id, _appointment_id, _client_id, _kind, _to_phone,
          COALESCE(_provider,'twilio'), _provider_sid, _status, _error_message, _body_preview)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- ---------------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_set_consent(
  _client_id uuid, _opt_in boolean, _source public.consent_source
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.clients
  SET whatsapp_opt_in = _opt_in,
      -- Timestamps are kept independently: an opt-out must not erase the
      -- record of when consent was originally given, and vice versa.
      whatsapp_opt_in_at  = CASE WHEN _opt_in THEN now() ELSE whatsapp_opt_in_at END,
      whatsapp_opt_out_at = CASE WHEN _opt_in THEN whatsapp_opt_out_at ELSE now() END,
      whatsapp_consent_source = _source,
      updated_at = now()
  WHERE id = _client_id;
  RETURN FOUND;
END $function$;

-- STOP arrives from a phone number, not a client id, and that number may exist
-- as a client of several brands. The person opting out has no concept of our
-- brands, so honour it everywhere that number appears.
CREATE OR REPLACE FUNCTION public.whatsapp_opt_out_by_phone(_phone text)
RETURNS TABLE(clients_updated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.clients
    SET whatsapp_opt_in = false,
        whatsapp_opt_out_at = now(),
        whatsapp_consent_source = 'inbound_stop',
        updated_at = now()
    WHERE whatsapp_opt_in = true
      -- Compare on digits only: stored numbers vary in spacing/format.
      AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(_phone, '[^0-9]', '', 'g')
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN QUERY SELECT v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.whatsapp_opt_in_by_phone(_phone text)
RETURNS TABLE(clients_updated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.clients
    SET whatsapp_opt_in = true,
        whatsapp_opt_in_at = now(),
        whatsapp_consent_source = 'inbound_stop',
        updated_at = now()
    WHERE whatsapp_opt_in = false
      AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(_phone, '[^0-9]', '', 'g')
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN QUERY SELECT v_count;
END $function$;

-- ---------------------------------------------------------------------------
-- Reminder sweep (Section 10: live query, no cached state)
--
-- Race safety comes from this query alone: status and starts_at are read at the
-- moment the job runs, so an appointment cancelled or moved during the reminder
-- window simply stops matching. No locks or synchronisation needed — the same
-- "trust a live query" principle as the overlap trigger and deposit expiry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_due_reminders(_limit int DEFAULT 50)
RETURNS TABLE(
  appointment_id uuid, brand_id uuid, client_id uuid,
  client_name text, phone text, service_name text,
  location_name text, starts_at timestamptz, timezone text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT a.id, a.brand_id, c.id, c.name, c.phone,
         COALESCE(s.name,'your appointment'), l.name, a.starts_at,
         COALESCE(l.timezone,'UTC')
  FROM public.appointments a
  JOIN public.clients c   ON c.id = a.client_id
  JOIN public.brands b    ON b.id = a.brand_id
  JOIN public.locations l ON l.id = a.location_id
  LEFT JOIN public.services s ON s.id = a.service_id
  WHERE a.status = 'scheduled'
    AND a.reminded_at IS NULL
    AND c.whatsapp_opt_in = true
    AND b.whatsapp_enabled = true
    -- Inside the brand's configured lead time, and not already started.
    AND a.starts_at > now()
    AND a.starts_at <= now() + make_interval(hours => b.reminder_lead_hours)
  ORDER BY a.starts_at
  LIMIT GREATEST(_limit, 1);
$function$;

-- Separate from the send so a provider failure leaves reminded_at NULL and the
-- appointment is retried on the next sweep, rather than being silently skipped.
CREATE OR REPLACE FUNCTION public.whatsapp_mark_reminded(_appointment_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.appointments
  SET reminded_at = now(), updated_at = now()
  WHERE id = _appointment_id AND reminded_at IS NULL;
  RETURN FOUND;
END $function$;

-- ---------------------------------------------------------------------------
-- Lock down to service_role, matching every other public_/payment_ RPC.
-- ---------------------------------------------------------------------------

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'whatsapp\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
