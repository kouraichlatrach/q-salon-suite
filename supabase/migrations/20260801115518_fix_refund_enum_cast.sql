-- Bug caught by end-to-end testing, not by reading the code: the provider
-- refund succeeded but recording it threw
--   42804: column "state" is of type payment_state but expression is of type text
-- because a CASE expression yields `text`, and Postgres will not implicitly
-- cast that to an enum in an INSERT target position. The literals inside the
-- CASE are never individually type-inferred — only the CASE result is.
--
-- Impact if shipped: money leaves the provider, the client is refunded, but the
-- system has no refund record and the appointment stays deposit_status='paid'.
-- Exactly the silent-money-loss class Section 7 says to be paranoid about.
CREATE OR REPLACE FUNCTION public.payment_record_refund(
  _brand_id uuid, _appointment_id uuid, _parent_payment_id uuid,
  _provider text, _provider_ref text, _amount numeric, _currency text,
  _idempotency_key text, _succeeded boolean, _failure_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.payments WHERE idempotency_key = _idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.payments(brand_id, appointment_id, kind, state, provider,
                              provider_ref, amount, currency, idempotency_key,
                              parent_payment_id, failure_reason)
  VALUES (_brand_id, _appointment_id, 'refund',
          (CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END)::public.payment_state,
          _provider, _provider_ref, _amount, _currency, _idempotency_key,
          _parent_payment_id, _failure_reason)
  RETURNING id INTO v_id;

  IF _succeeded THEN
    UPDATE public.appointments SET deposit_status = 'refunded', updated_at = now()
    WHERE id = _appointment_id;
  END IF;

  INSERT INTO public.payment_events(payment_id, appointment_id, event_type, payload)
  VALUES (v_id, _appointment_id,
          CASE WHEN _succeeded THEN 'refund.succeeded' ELSE 'refund.failed' END,
          jsonb_build_object('amount', _amount, 'provider_ref', _provider_ref,
                             'reason', _failure_reason));
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.payment_record_refund(uuid,uuid,uuid,text,text,numeric,text,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_record_refund(uuid,uuid,uuid,text,text,numeric,text,text,boolean,text) TO service_role;
