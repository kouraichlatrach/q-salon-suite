-- Appointment settlement — one transaction for the money side of checkout.
--
-- Completing an appointment previously did two independent client-side writes:
-- insert income_records, then update appointments.status. Adding gift cards
-- would have made it three, with a decremented card balance in the middle —
-- and a failure after the redeem would leave the customer's card debited for an
-- appointment that never completed. Section 4 bug class 3 is exactly this:
-- every write that must succeed together belongs in one exception scope.
--
-- Service records and product usage stay on the client side deliberately. They
-- are not money, they already work, and the stock-deduction trigger they fire
-- is orthogonal to payment.

CREATE OR REPLACE FUNCTION public.appointment_settle(
  _appointment_id uuid,
  _amount numeric,
  _method public.payment_method,
  _gift_card_code text DEFAULT NULL,
  _gift_card_amount numeric DEFAULT NULL
) RETURNS TABLE(
  gift_applied numeric, gift_remaining numeric, cash_amount numeric, error text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a public.appointments%ROWTYPE;
  v_applied numeric := 0;
  v_remaining numeric := NULL;
  v_cash numeric;
  r RECORD;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = _appointment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, 'unknown_appointment'::text;
    RETURN;
  END IF;

  IF NOT public.can_manage_location(auth.uid(), a.location_id) THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, 'forbidden'::text;
    RETURN;
  END IF;

  IF _amount IS NULL OR _amount < 0 THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, 'invalid_amount'::text;
    RETURN;
  END IF;

  -- Gift card first: it is the constrained resource, and if it fails the whole
  -- settlement must fail rather than silently charging the customer cash.
  IF _gift_card_code IS NOT NULL AND btrim(_gift_card_code) <> '' THEN
    SELECT * INTO r FROM public.gift_card_redeem(
      a.brand_id,
      _gift_card_code,
      _appointment_id,
      a.client_id,
      LEAST(COALESCE(_gift_card_amount, _amount), _amount)
    );

    IF r.error IS NOT NULL THEN
      -- Surfaces the specific reason (expired / not_found / no_balance) rather
      -- than a generic failure, per Section 4 bug class 4.
      RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, r.error;
      RETURN;
    END IF;

    v_applied := COALESCE(r.applied, 0);
    v_remaining := r.remaining;
  END IF;

  v_cash := _amount - v_applied;
  IF v_cash < 0 THEN v_cash := 0; END IF;

  -- Only the portion actually paid now is logged as income. The gift card
  -- portion was already recognised as revenue when the card was sold, so
  -- logging it again here would report the same money twice.
  IF v_cash > 0 THEN
    INSERT INTO public.income_records(
      appointment_id, location_id, brand_id, amount, currency,
      method, collected_by, source)
    VALUES (_appointment_id, a.location_id, a.brand_id, v_cash,
            COALESCE(a.currency, 'QAR'), _method, auth.uid(), 'appointment');
  END IF;

  UPDATE public.appointments
  SET status = 'completed', price = _amount, updated_at = now()
  WHERE id = _appointment_id;

  RETURN QUERY SELECT v_applied, v_remaining, v_cash, NULL::text;
END $function$;

REVOKE ALL ON FUNCTION public.appointment_settle(uuid, numeric, public.payment_method, text, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.appointment_settle(uuid, numeric, public.payment_method, text, numeric)
  TO authenticated, service_role;
