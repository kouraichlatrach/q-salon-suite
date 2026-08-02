-- Appointment settlement — extended for package redemption.
--
-- Checkout can now draw on three things in one transaction: a prepaid package
-- session, a gift card balance, and money collected today. All three plus the
-- status change must succeed or fail together, for the same reason the gift
-- card version already gave — a failure part-way through would debit a
-- customer's prepaid value for an appointment that never completed
-- (Section 4 bug class 3).
--
-- The 5-argument version is dropped rather than left alongside this one.
-- CREATE OR REPLACE cannot change a function's argument count, so adding a
-- defaulted parameter would create an *overload*, and a 5-argument call would
-- then match both signatures — PostgREST reports that as "function is not
-- unique" and every existing checkout would break.
DROP FUNCTION IF EXISTS public.appointment_settle(
  uuid, numeric, public.payment_method, text, numeric);

CREATE OR REPLACE FUNCTION public.appointment_settle(
  _appointment_id uuid,
  _amount numeric,
  _method public.payment_method,
  _gift_card_code text DEFAULT NULL,
  _gift_card_amount numeric DEFAULT NULL,
  _client_package_id uuid DEFAULT NULL
) RETURNS TABLE(
  package_covered numeric, package_remaining int,
  gift_applied numeric, gift_remaining numeric,
  cash_amount numeric, error text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a public.appointments%ROWTYPE;
  v_pkg_covered numeric := 0;
  v_pkg_remaining int := NULL;
  v_applied numeric := 0;
  v_remaining numeric := NULL;
  v_due numeric;
  v_cash numeric;
  r RECORD;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = _appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                        NULL::numeric, 'unknown_appointment'::text;
    RETURN;
  END IF;

  IF NOT public.can_manage_location(auth.uid(), a.location_id) THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                        NULL::numeric, 'forbidden'::text;
    RETURN;
  END IF;

  -- Settling twice is a money bug, not a no-op. Completing an already-completed
  -- appointment previously ran the whole flow again: a second gift card debit,
  -- a second income record, and now potentially a second package session burned.
  -- The UI offers "Mark completed" unconditionally and nothing stops a
  -- double-click or a stale tab, so the guard belongs here, where the money
  -- rules live, rather than in one caller's disabled-button state.
  IF a.status = 'completed'::public.appointment_status THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                        NULL::numeric, 'already_completed'::text;
    RETURN;
  END IF;

  IF _amount IS NULL OR _amount < 0 THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                        NULL::numeric, 'invalid_amount'::text;
    RETURN;
  END IF;

  v_due := _amount;

  -- Package first. It is the most constrained resource (a whole session, not a
  -- divisible balance) and it covers a specific service rather than an amount,
  -- so it settles before anything divisible is applied.
  IF _client_package_id IS NOT NULL THEN
    IF a.service_id IS NULL THEN
      RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                          NULL::numeric, 'package_service_not_covered'::text;
      RETURN;
    END IF;

    SELECT * INTO r FROM public.package_redeem(
      a.brand_id, _client_package_id, a.service_id, _appointment_id,
      a.client_id, a.location_id);

    IF r.error IS NOT NULL THEN
      -- Surfaces the specific reason (expired / no sessions / wrong client)
      -- rather than a generic failure, per Section 4 bug class 4.
      RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                          NULL::numeric, r.error;
      RETURN;
    END IF;

    v_pkg_covered := COALESCE(r.covered, 0);
    v_pkg_remaining := r.remaining;

    -- The package cannot cover more than is being charged. If the service is
    -- priced above what staff actually entered, the session still gets used —
    -- it was consumed either way — but it never produces negative cash.
    IF v_pkg_covered > v_due THEN
      v_pkg_covered := v_due;
    END IF;
    v_due := v_due - v_pkg_covered;
  END IF;

  -- Gift card against whatever the package did not cover.
  IF _gift_card_code IS NOT NULL AND btrim(_gift_card_code) <> '' AND v_due > 0 THEN
    SELECT * INTO r FROM public.gift_card_redeem(
      a.brand_id,
      _gift_card_code,
      _appointment_id,
      a.client_id,
      LEAST(COALESCE(_gift_card_amount, v_due), v_due)
    );

    IF r.error IS NOT NULL THEN
      RETURN QUERY SELECT NULL::numeric, NULL::int, NULL::numeric, NULL::numeric,
                          NULL::numeric, r.error;
      RETURN;
    END IF;

    v_applied := COALESCE(r.applied, 0);
    v_remaining := r.remaining;
    v_due := v_due - v_applied;
  END IF;

  v_cash := v_due;
  IF v_cash < 0 THEN v_cash := 0; END IF;

  -- Only money actually collected now is logged as income. The package and the
  -- gift card were both recognised as revenue when they were sold, so logging
  -- either here would report the same riyal twice. This is the single most
  -- important rule shared across both features.
  IF v_cash > 0 THEN
    INSERT INTO public.income_records(
      appointment_id, location_id, brand_id, amount, currency,
      method, collected_by, source)
    VALUES (_appointment_id, a.location_id, a.brand_id, v_cash,
            COALESCE(a.currency, 'QAR'), _method, auth.uid(), 'appointment');
  END IF;

  UPDATE public.appointments
  SET status = 'completed',
      price = _amount,
      -- Record what actually covered this visit, replacing any booking-time
      -- intent. If staff switched the package off at checkout, the stale intent
      -- must not survive and claim coverage that never happened.
      client_package_id = _client_package_id,
      updated_at = now()
  WHERE id = _appointment_id;

  RETURN QUERY SELECT v_pkg_covered, v_pkg_remaining, v_applied, v_remaining,
                      v_cash, NULL::text;
END $function$;

REVOKE ALL ON FUNCTION public.appointment_settle(
  uuid, numeric, public.payment_method, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.appointment_settle(
  uuid, numeric, public.payment_method, text, numeric, uuid)
  TO authenticated, service_role;
