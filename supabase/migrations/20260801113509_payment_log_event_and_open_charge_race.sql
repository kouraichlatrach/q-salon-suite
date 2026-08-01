-- Two additions surfaced while wiring the webhook handler.

-- 1. Generic append-only audit writer. The webhook needs to log rejected
--    payloads (which by definition have no payment row to attach to), so it
--    can't go through payment_open_charge/confirm. Kept deliberately narrow:
--    insert into the audit log, nothing else.
CREATE OR REPLACE FUNCTION public.payment_log_event(
  _payment_id uuid, _appointment_id uuid, _event_type text,
  _signature_verified boolean, _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.payment_events(payment_id, appointment_id, event_type,
                                    signature_verified, payload)
  VALUES (_payment_id, _appointment_id, _event_type, _signature_verified, _payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- 2. payment_open_charge did SELECT-then-INSERT on idempotency_key, which two
--    concurrent callers can both pass before either inserts — the loser then
--    hit a raw unique-violation instead of getting the winner's row. Handle the
--    conflict explicitly so a double-submit collapses cleanly.
CREATE OR REPLACE FUNCTION public.payment_open_charge(
  _brand_id uuid, _appointment_id uuid, _provider text, _provider_ref text,
  _amount numeric, _currency text, _idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.payments(brand_id, appointment_id, kind, state, provider,
                              provider_ref, amount, currency, idempotency_key)
  VALUES (_brand_id, _appointment_id, 'charge', 'pending', _provider,
          _provider_ref, _amount, _currency, _idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost the race (or a genuine replay): return the existing row unchanged.
    SELECT id INTO v_id FROM public.payments WHERE idempotency_key = _idempotency_key;
    RETURN v_id;
  END IF;

  INSERT INTO public.payment_events(payment_id, appointment_id, event_type, payload)
  VALUES (v_id, _appointment_id, 'charge.opened',
          jsonb_build_object('provider', _provider, 'provider_ref', _provider_ref, 'amount', _amount));
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.payment_log_event(uuid,uuid,text,boolean,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_log_event(uuid,uuid,text,boolean,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.payment_open_charge(uuid,uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_open_charge(uuid,uuid,text,text,numeric,text,text) TO service_role;
