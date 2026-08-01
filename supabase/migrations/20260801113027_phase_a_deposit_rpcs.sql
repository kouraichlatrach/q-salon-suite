-- Payments Phase A — RPC layer.
--
-- Division of responsibility, deliberately: the database owns every state
-- transition and all money arithmetic; the Node layer owns only provider I/O.
-- The DB cannot call a payment provider, so functions that need one (refunds)
-- return an *instruction* for the caller to execute and then report back. This
-- keeps the atomic parts atomic (bug class #3) without pretending the network
-- call is transactional.
--
-- Every function here is SECURITY DEFINER with a minimal search_path, and
-- pgcrypto calls are fully schema-qualified (bug class #2).

-- ---------------------------------------------------------------------------
-- Deposit resolution (spec items 1 & 2)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_resolve_deposit(
  _brand_id uuid, _service_id uuid, _location_id uuid, _phone text
) RETURNS TABLE(
  deposit_required  boolean,
  deposit_mandatory boolean,
  deposit_amount    numeric,
  currency          text,
  is_new_client     boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_svc RECORD;
  v_price numeric;
  v_ccy text;
  v_new boolean;
  v_amt numeric;
BEGIN
  SELECT s.deposit_required, s.deposit_mandatory, s.deposit_amount,
         s.deposit_percentage, s.deposit_new_clients_only,
         COALESCE(slp.price, s.default_price)     AS price,
         COALESCE(slp.currency, s.currency)       AS ccy
    INTO v_svc
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.id = _service_id AND s.brand_id = _brand_id AND s.is_active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::numeric, NULL::text, false; RETURN;
  END IF;

  v_price := v_svc.price;
  v_ccy   := v_svc.ccy;

  -- "New client" = this phone has no *completed* appointment with this brand.
  -- Phone is the identity key throughout the booking portal, so it stays the
  -- key here too; a client who booked but never showed is still "new".
  v_new := NOT EXISTS (
    SELECT 1 FROM public.appointments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE c.brand_id = _brand_id
      AND c.phone = _phone
      AND a.status = 'completed'
  );

  -- Item 2: a service can require a deposit from new clients only. When that
  -- flag is set, returning clients are exempt even though the service has a
  -- deposit configured.
  IF NOT v_svc.deposit_required THEN
    RETURN QUERY SELECT false, false, NULL::numeric, v_ccy, v_new; RETURN;
  END IF;
  IF v_svc.deposit_new_clients_only AND NOT v_new THEN
    RETURN QUERY SELECT false, false, NULL::numeric, v_ccy, v_new; RETURN;
  END IF;

  v_amt := CASE
    WHEN v_svc.deposit_amount IS NOT NULL THEN v_svc.deposit_amount
    ELSE round(v_price * v_svc.deposit_percentage / 100.0, 2)
  END;

  -- Never ask for more than the service costs.
  IF v_amt > v_price THEN v_amt := v_price; END IF;

  IF v_amt IS NULL OR v_amt <= 0 THEN
    RETURN QUERY SELECT false, false, NULL::numeric, v_ccy, v_new; RETURN;
  END IF;

  RETURN QUERY SELECT true, v_svc.deposit_mandatory, v_amt, v_ccy, v_new;
END $function$;

-- ---------------------------------------------------------------------------
-- Booking with a deposit hold (spec item 8: book-first, real DB hold)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.public_book_appointment(uuid,uuid,uuid,uuid,timestamptz,text,text,text);

CREATE OR REPLACE FUNCTION public.public_book_appointment(
  _brand_id uuid, _location_id uuid, _service_id uuid, _staff_user_id uuid,
  _starts_at timestamptz, _client_name text, _phone text, _notes text,
  _deposit_skipped boolean DEFAULT false
) RETURNS TABLE(
  appointment_id   uuid,
  token            text,
  error            text,
  deposit_required boolean,
  deposit_amount   numeric,
  hold_expires_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_client_id uuid; v_service RECORD; v_ends timestamptz;
  v_appt uuid; v_token text; v_staff uuid := _staff_user_id;
  v_dep RECORD; v_hold_minutes int; v_hold_expires timestamptz;
  v_dep_status public.deposit_status; v_skipped boolean := false;
BEGIN
  SELECT s.duration_minutes,
         COALESCE(slp.price, s.default_price) AS price,
         COALESCE(slp.currency, s.currency)   AS currency
    INTO v_service
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.id = _service_id AND s.brand_id = _brand_id AND s.is_active = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'service_unavailable'::text,
                        false, NULL::numeric, NULL::timestamptz; RETURN;
  END IF;

  v_ends := _starts_at + make_interval(mins => v_service.duration_minutes);

  IF v_staff IS NULL THEN
    SELECT ur.user_id INTO v_staff
    FROM public.user_roles ur
    JOIN public.staff_services ss
      ON ss.user_id = ur.user_id AND ss.service_id = _service_id
    WHERE ur.brand_id = _brand_id
      AND ur.user_id IS NOT NULL
      AND (ur.location_id = _location_id OR ur.role IN ('owner','manager'))
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.staff_user_id = ur.user_id
          -- expiry-aware, matching the trigger and the slot picker
          AND public.appointment_holds_slot(a.status, a.deposit_status, a.deposit_hold_expires_at)
          AND a.starts_at < v_ends AND a.ends_at > _starts_at
      )
    LIMIT 1;
    IF v_staff IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'no_staff_available'::text,
                          false, NULL::numeric, NULL::timestamptz; RETURN;
    END IF;
  END IF;

  SELECT * INTO v_dep FROM public.public_resolve_deposit(_brand_id, _service_id, _location_id, _phone);

  -- A mandatory deposit cannot be skipped; an optional one can, and that fact
  -- is recorded so staff see the badge (item 3).
  IF v_dep.deposit_required AND _deposit_skipped THEN
    IF v_dep.deposit_mandatory THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'deposit_required'::text,
                          true, v_dep.deposit_amount, NULL::timestamptz; RETURN;
    END IF;
    v_skipped := true;
  END IF;

  IF v_dep.deposit_required AND NOT v_skipped THEN
    SELECT deposit_hold_minutes INTO v_hold_minutes FROM public.brands WHERE id = _brand_id;
    v_hold_expires := now() + make_interval(mins => COALESCE(v_hold_minutes, 15));
    v_dep_status := 'pending';
  END IF;

  SELECT id INTO v_client_id FROM public.clients
    WHERE brand_id = _brand_id AND phone = _phone LIMIT 1;

  BEGIN
    -- Client + appointment must succeed or fail together (bug class #3).
    IF v_client_id IS NULL THEN
      INSERT INTO public.clients(brand_id, name, phone)
      VALUES (_brand_id, COALESCE(NULLIF(_client_name,''), 'Guest'), _phone)
      RETURNING id INTO v_client_id;
    END IF;

    INSERT INTO public.appointments(
      brand_id, location_id, client_id, staff_user_id, service_id,
      starts_at, ends_at, status, notes, price, currency,
      deposit_status, deposit_amount, deposit_hold_expires_at, deposit_skipped
    ) VALUES (
      _brand_id, _location_id, v_client_id, v_staff, _service_id,
      _starts_at, v_ends, 'scheduled', _notes, v_service.price, v_service.currency,
      v_dep_status,
      CASE WHEN v_dep.deposit_required AND NOT v_skipped THEN v_dep.deposit_amount END,
      v_hold_expires, v_skipped
    ) RETURNING id INTO v_appt;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'slot_taken'::text,
                        false, NULL::numeric, NULL::timestamptz; RETURN;
  END;

  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(24),'base64'),'+','-'),'/','_'),'=','');
  INSERT INTO public.booking_tokens(token, appointment_id, expires_at)
  VALUES (v_token, v_appt, v_ends + interval '30 days');

  IF v_dep_status = 'pending' THEN
    INSERT INTO public.payment_events (appointment_id, event_type, payload)
    VALUES (v_appt, 'deposit.hold_created',
            jsonb_build_object('amount', v_dep.deposit_amount, 'expires_at', v_hold_expires));
  END IF;

  RETURN QUERY SELECT v_appt, v_token, NULL::text,
                      COALESCE(v_dep_status = 'pending', false),
                      CASE WHEN v_dep_status = 'pending' THEN v_dep.deposit_amount END,
                      v_hold_expires;
END $function$;

-- ---------------------------------------------------------------------------
-- Charge lifecycle. Idempotent by construction (Section 7).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payment_open_charge(
  _brand_id uuid, _appointment_id uuid, _provider text, _provider_ref text,
  _amount numeric, _currency text, _idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  -- Replaying the same idempotency key returns the original row rather than
  -- creating a second charge.
  SELECT id INTO v_id FROM public.payments WHERE idempotency_key = _idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.payments(brand_id, appointment_id, kind, state, provider,
                              provider_ref, amount, currency, idempotency_key)
  VALUES (_brand_id, _appointment_id, 'charge', 'pending', _provider,
          _provider_ref, _amount, _currency, _idempotency_key)
  RETURNING id INTO v_id;

  INSERT INTO public.payment_events(payment_id, appointment_id, event_type, payload)
  VALUES (v_id, _appointment_id, 'charge.opened',
          jsonb_build_object('provider', _provider, 'provider_ref', _provider_ref, 'amount', _amount));
  RETURN v_id;
END $function$;

-- Webhook-as-source-of-truth: this is the ONLY path that marks a deposit paid.
CREATE OR REPLACE FUNCTION public.payment_confirm_charge(
  _provider text, _provider_ref text, _amount numeric, _payload jsonb
) RETURNS TABLE(applied boolean, appointment_id uuid, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pay RECORD;
BEGIN
  SELECT * INTO v_pay FROM public.payments
  WHERE provider = _provider AND provider_ref = _provider_ref AND kind = 'charge'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Log unknown refs too: a forged or misrouted webhook should leave a trace.
    INSERT INTO public.payment_events(event_type, signature_verified, payload)
    VALUES ('charge.unknown_ref', true,
            jsonb_build_object('provider', _provider, 'provider_ref', _provider_ref, 'payload', _payload));
    RETURN QUERY SELECT false, NULL::uuid, 'unknown_charge'::text; RETURN;
  END IF;

  IF v_pay.state = 'succeeded' THEN
    INSERT INTO public.payment_events(payment_id, appointment_id, event_type, signature_verified, payload)
    VALUES (v_pay.id, v_pay.appointment_id, 'charge.duplicate_webhook', true, _payload);
    RETURN QUERY SELECT false, v_pay.appointment_id, 'already_succeeded'::text; RETURN;
  END IF;

  -- Amount mismatch is a red flag; record and refuse rather than trust it.
  IF _amount IS NOT NULL AND _amount <> v_pay.amount THEN
    INSERT INTO public.payment_events(payment_id, appointment_id, event_type, signature_verified, payload)
    VALUES (v_pay.id, v_pay.appointment_id, 'charge.amount_mismatch', true,
            jsonb_build_object('expected', v_pay.amount, 'received', _amount));
    RETURN QUERY SELECT false, v_pay.appointment_id, 'amount_mismatch'::text; RETURN;
  END IF;

  UPDATE public.payments SET state = 'succeeded', updated_at = now() WHERE id = v_pay.id;

  -- Deposit is paid: the hold becomes permanent, so clear the expiry.
  UPDATE public.appointments
  SET deposit_status = 'paid',
      deposit_paid_amount = v_pay.amount,
      deposit_hold_expires_at = NULL,
      updated_at = now()
  WHERE id = v_pay.appointment_id;

  INSERT INTO public.payment_events(payment_id, appointment_id, event_type, signature_verified, payload)
  VALUES (v_pay.id, v_pay.appointment_id, 'charge.succeeded', true, _payload);

  RETURN QUERY SELECT true, v_pay.appointment_id, NULL::text;
END $function$;

CREATE OR REPLACE FUNCTION public.payment_fail_charge(
  _provider text, _provider_ref text, _reason text, _payload jsonb
) RETURNS TABLE(applied boolean, appointment_id uuid, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pay RECORD;
BEGIN
  SELECT * INTO v_pay FROM public.payments
  WHERE provider = _provider AND provider_ref = _provider_ref AND kind = 'charge'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'unknown_charge'::text; RETURN;
  END IF;
  IF v_pay.state = 'succeeded' THEN
    -- Never let a late "failed" event undo a confirmed payment.
    RETURN QUERY SELECT false, v_pay.appointment_id, 'already_succeeded'::text; RETURN;
  END IF;

  UPDATE public.payments
  SET state = 'failed', failure_reason = _reason, updated_at = now()
  WHERE id = v_pay.id;

  -- The hold is left alone: it simply expires on its own, which lets the client
  -- retry payment within the window instead of losing the slot on first failure.
  INSERT INTO public.payment_events(payment_id, appointment_id, event_type, signature_verified, payload)
  VALUES (v_pay.id, v_pay.appointment_id, 'charge.failed', true,
          COALESCE(_payload,'{}'::jsonb) || jsonb_build_object('reason', _reason));

  RETURN QUERY SELECT true, v_pay.appointment_id, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Cancellation + time-based refund policy (spec items 5 & 6)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.public_cancel_by_token(text);

-- Returns an instruction, not a result: the caller performs the provider refund
-- and then calls payment_record_refund() to close the loop.
CREATE OR REPLACE FUNCTION public.public_cancel_by_token(_token text)
RETURNS TABLE(
  ok             boolean,
  appointment_id uuid,
  brand_id       uuid,
  refund_due     boolean,
  refund_amount  numeric,
  currency       text,
  charge_ref     text,
  charge_id      uuid,
  outcome        text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_appt RECORD; v_cutoff int; v_deadline timestamptz;
  v_refund boolean := false; v_outcome text := 'no_deposit';
  v_charge RECORD;
BEGIN
  SELECT a.* INTO v_appt
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now())
    AND a.status = 'scheduled'
    AND a.starts_at > now()
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, false, NULL::numeric,
                        NULL::text, NULL::text, NULL::uuid, 'not_cancellable'::text; RETURN;
  END IF;

  IF v_appt.deposit_status = 'paid' THEN
    SELECT refund_cutoff_hours INTO v_cutoff FROM public.brands WHERE id = v_appt.brand_id;
    v_deadline := v_appt.starts_at - make_interval(hours => COALESCE(v_cutoff, 24));
    -- Item 5: full refund before the cutoff, forfeited after it.
    v_refund := now() < v_deadline;
    v_outcome := CASE WHEN v_refund THEN 'refund_due' ELSE 'forfeited' END;

    SELECT p.id, p.provider_ref, p.amount, p.currency INTO v_charge
    FROM public.payments p
    WHERE p.appointment_id = v_appt.id AND p.kind = 'charge' AND p.state = 'succeeded'
    ORDER BY p.created_at DESC LIMIT 1;

    IF v_refund AND v_charge.id IS NULL THEN
      -- Marked paid with no succeeded charge row: refuse to invent a refund.
      v_refund := false; v_outcome := 'refund_unavailable';
    END IF;
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled',
      deposit_status = CASE
        WHEN deposit_status = 'paid' AND NOT v_refund THEN 'forfeited'::public.deposit_status
        ELSE deposit_status END,
      updated_at = now()
  WHERE id = v_appt.id;

  INSERT INTO public.payment_events(appointment_id, event_type, payload)
  VALUES (v_appt.id, 'appointment.cancelled',
          jsonb_build_object('outcome', v_outcome, 'refund_due', v_refund,
                             'cutoff_hours', v_cutoff, 'starts_at', v_appt.starts_at));

  RETURN QUERY SELECT true, v_appt.id, v_appt.brand_id, v_refund,
                      v_charge.amount, COALESCE(v_charge.currency, v_appt.currency),
                      v_charge.provider_ref, v_charge.id, v_outcome;
END $function$;

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
          CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END,
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

-- ---------------------------------------------------------------------------
-- Item 4: deposit counts toward the total — staff log only the remainder.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.appointment_balance_due(_appointment_id uuid)
RETURNS TABLE(total numeric, deposit_paid numeric, balance numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT a.price,
         -- Only a deposit that is still credited to the client counts. A
         -- forfeited or refunded deposit must not reduce what's owed.
         COALESCE(CASE WHEN a.deposit_status = 'paid' THEN a.deposit_paid_amount END, 0),
         GREATEST(a.price - COALESCE(CASE WHEN a.deposit_status = 'paid' THEN a.deposit_paid_amount END, 0), 0),
         a.currency
  FROM public.appointments a WHERE a.id = _appointment_id;
$function$;

-- ---------------------------------------------------------------------------
-- Item 7: staff-triggered deposit request for walk-ins / phone bookings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_request_deposit(_appointment_id uuid, _amount numeric DEFAULT NULL)
RETURNS TABLE(ok boolean, brand_id uuid, amount numeric, currency text, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_appt RECORD; v_amt numeric; v_hold int;
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
  IF v_amt IS NULL OR v_amt <= 0 THEN
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
  VALUES (_appointment_id, 'deposit.requested_in_store', jsonb_build_object('amount', v_amt));

  RETURN QUERY SELECT true, v_appt.brand_id, v_amt, v_appt.currency, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Lock everything down to service_role, matching the existing public_* RPCs.
-- ---------------------------------------------------------------------------

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'public\_%' OR p.proname LIKE 'payment\_%'
           OR p.proname IN ('staff_request_deposit','appointment_balance_due','expire_stale_deposit_holds'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
