-- staff_request_deposit only fell back to appointments.deposit_amount, which is
-- NULL for exactly the bookings item 7 targets: walk-ins and phone bookings that
-- never went through the public deposit flow, and bookings where the client
-- declined an optional deposit. Staff then got 'no_amount' unless they typed a
-- figure manually.
--
-- Now falls back to the service's own configured deposit rule (resolved through
-- the same function the public flow uses, so a percentage deposit is computed
-- off the effective per-location price rather than the list price). An explicit
-- amount still wins — staff override remains possible.
CREATE OR REPLACE FUNCTION public.staff_request_deposit(_appointment_id uuid, _amount numeric DEFAULT NULL)
RETURNS TABLE(ok boolean, brand_id uuid, amount numeric, currency text, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_appt RECORD; v_amt numeric; v_hold int; v_phone text; v_dep RECORD;
BEGIN
  SELECT * INTO v_appt FROM public.appointments WHERE id = _appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::numeric, NULL::text, 'not_found'::text; RETURN;
  END IF;
  IF v_appt.status <> 'scheduled' THEN
    RETURN QUERY SELECT false, v_appt.brand_id, NULL::numeric, v_appt.currency, 'not_scheduled'::text; RETURN;
  END IF;
  IF v_appt.deposit_status = 'paid' THEN
    RETURN QUERY SELECT false, v_appt.brand_id, NULL::numeric, v_appt.currency, 'already_paid'::text; RETURN;
  END IF;

  v_amt := COALESCE(_amount, v_appt.deposit_amount);

  IF v_amt IS NULL THEN
    SELECT c.phone INTO v_phone FROM public.clients c WHERE c.id = v_appt.client_id;
    SELECT d.deposit_amount INTO v_dep
    FROM public.public_resolve_deposit(v_appt.brand_id, v_appt.service_id,
                                       v_appt.location_id, COALESCE(v_phone,'')) d;
    v_amt := v_dep.deposit_amount;
  END IF;

  IF v_amt IS NULL OR v_amt <= 0 THEN
    -- Genuinely nothing configured: staff must supply a figure explicitly.
    RETURN QUERY SELECT false, v_appt.brand_id, NULL::numeric, v_appt.currency, 'no_amount'::text; RETURN;
  END IF;
  IF v_amt > v_appt.price THEN v_amt := v_appt.price; END IF;

  SELECT deposit_hold_minutes INTO v_hold FROM public.brands WHERE id = v_appt.brand_id;

  UPDATE public.appointments
  SET deposit_status = 'pending',
      deposit_amount = v_amt,
      deposit_skipped = false,
      deposit_hold_expires_at = now() + make_interval(mins => COALESCE(v_hold, 15)),
      updated_at = now()
  WHERE id = _appointment_id;

  INSERT INTO public.payment_events(appointment_id, event_type, payload)
  VALUES (_appointment_id, 'deposit.requested_in_store',
          jsonb_build_object('amount', v_amt, 'explicit', _amount IS NOT NULL));

  RETURN QUERY SELECT true, v_appt.brand_id, v_amt, v_appt.currency, NULL::text;
END $function$;

REVOKE ALL ON FUNCTION public.staff_request_deposit(uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_request_deposit(uuid,numeric) TO service_role;
