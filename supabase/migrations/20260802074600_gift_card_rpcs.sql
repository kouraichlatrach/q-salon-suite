-- Gift Cards — RPC layer.
--
-- Same division as Payments and WhatsApp: the database owns the money rules,
-- the UI only asks. Every balance change happens inside one of these functions
-- so a decrement can never be recorded without the redemption row that
-- justifies it (Section 4 bug class 3 — atomic scope for multi-step writes).
--
-- These are called from the browser as the `authenticated` role, unlike the
-- public_/whatsapp_ RPCs which are service_role only. They are therefore
-- SECURITY DEFINER *with an explicit auth.uid() check inside* — the check is
-- the access control, since RLS is bypassed by definition here.

-- ---------------------------------------------------------------------------
-- Code generation.
--
-- Alphabet excludes 0/O/1/I/L: these codes get read aloud over a counter and
-- typed by hand at redemption, and those four are the characters people
-- reliably get wrong. 8 characters from a 31-character alphabet is ~8.5e11
-- combinations, which matters because a guessable code is stored value someone
-- else can spend.
--
-- pgcrypto lives in the `extensions` schema, so gen_random_bytes must be
-- fully qualified — an unqualified call fails under SET search_path TO 'public'
-- (Section 4 bug class 2). Not random(), which is not cryptographically seeded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_card_generate_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_raw text;
  v_code text;
  i int;
  v_attempts int := 0;
BEGIN
  LOOP
    v_raw := '';
    FOR i IN 1..8 LOOP
      v_raw := v_raw || substr(
        v_alphabet,
        (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)) + 1,
        1);
    END LOOP;
    v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.code = v_code);

    v_attempts := v_attempts + 1;
    IF v_attempts > 50 THEN
      RAISE EXCEPTION 'could not generate a unique gift card code after 50 attempts';
    END IF;
  END LOOP;
  RETURN v_code;
END $function$;

-- Staff will type these with or without the dash, in any case. Canonical form
-- is uppercase XXXX-XXXX; comparison strips everything else so a mistyped
-- separator is not treated as an unknown card.
CREATE OR REPLACE FUNCTION public.gift_card_normalize_code(_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT upper(regexp_replace(COALESCE(_code, ''), '[^A-Za-z0-9]', '', 'g'));
$function$;

-- ---------------------------------------------------------------------------
-- Sale.
--
-- Creates the card and logs the income in one transaction. Money physically
-- changed hands, so the income record is not optional — if it fails, the card
-- must not exist either.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_card_sell(
  _brand_id uuid,
  _location_id uuid,
  _amount numeric,
  _method public.payment_method,
  _note text DEFAULT NULL
) RETURNS TABLE(gift_card_id uuid, code text, expires_at timestamptz, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_id uuid;
  v_code text;
  v_expires timestamptz;
  v_enabled boolean;
  v_months int;
  v_currency text;
BEGIN
  IF NOT public.can_manage_location(auth.uid(), _location_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'forbidden'::text;
    RETURN;
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'invalid_amount'::text;
    RETURN;
  END IF;

  SELECT b.gift_card_expiry_enabled, b.gift_card_expiry_months, COALESCE(b.currency, 'QAR')
    INTO v_enabled, v_months, v_currency
  FROM public.brands b WHERE b.id = _brand_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'unknown_brand'::text;
    RETURN;
  END IF;

  -- Expiry is stamped at purchase from the settings in force *now*. A later
  -- settings change must not retroactively expire cards already sold
  -- (Section 11 / brief item: expiry applies at time of purchase).
  IF v_enabled THEN
    v_expires := now() + make_interval(months => v_months);
  ELSE
    v_expires := NULL;
  END IF;

  v_code := public.gift_card_generate_code();

  INSERT INTO public.gift_cards(
    brand_id, location_id, code, initial_amount, remaining_amount,
    currency, expires_at, status, sold_by, note)
  VALUES (_brand_id, _location_id, v_code, _amount, _amount,
          v_currency, v_expires, 'active', auth.uid(), NULLIF(btrim(COALESCE(_note,'')), ''))
  RETURNING id INTO v_id;

  -- Revenue is recognised HERE, at the sale, because this is when the money
  -- actually arrives. Redemption deliberately does not log income again — see
  -- gift_card_redeem for why that would double-count.
  INSERT INTO public.income_records(
    appointment_id, location_id, brand_id, amount, currency,
    method, collected_by, source, gift_card_id)
  VALUES (NULL, _location_id, _brand_id, _amount, v_currency,
          _method, auth.uid(), 'gift_card_sale', v_id);

  RETURN QUERY SELECT v_id, v_code, v_expires, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Lookup, for the redemption UI.
--
-- effective_status derives expiry live rather than trusting the stored column,
-- so a card that expired since it was sold reports correctly without any job
-- having run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_card_lookup(_brand_id uuid, _code text)
RETURNS TABLE(
  id uuid, code text, initial_amount numeric, remaining_amount numeric,
  currency text, expires_at timestamptz, status text, effective_status text,
  client_id uuid, error text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE g public.gift_cards%ROWTYPE;
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::numeric,
      NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::uuid, 'forbidden'::text;
    RETURN;
  END IF;

  SELECT * INTO g FROM public.gift_cards c
  WHERE c.brand_id = _brand_id
    -- Brand-scoped: one brand can never look up another's card, even though
    -- codes are globally unique.
    AND public.gift_card_normalize_code(c.code) = public.gift_card_normalize_code(_code);

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::numeric,
      NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::uuid, 'not_found'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    g.id, g.code, g.initial_amount, g.remaining_amount, g.currency, g.expires_at,
    g.status::text,
    CASE
      WHEN g.status IN ('refunded','redeemed') THEN g.status::text
      WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
      WHEN g.remaining_amount <= 0 THEN 'redeemed'
      ELSE 'active'
    END,
    g.client_id, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Redemption.
--
-- Partial by design: a 200 QAR card against a 90 QAR service leaves 110 QAR
-- (Section 11 / brief item 3), and the card stays usable across future visits
-- until the balance reaches zero.
--
-- SELECT ... FOR UPDATE locks the card row for the transaction. Without it,
-- two concurrent checkouts reading the same balance could each pass the
-- sufficient-funds check and both decrement — spending the same money twice.
-- This is the one place in the feature where a lock is genuinely required,
-- because unlike the reminder sweep the decision and the write must agree.
--
-- Deliberately does NOT write an income_record. The money was already banked
-- and recognised at sale time; logging it again here would report the same
-- riyal as revenue twice. The caller logs only the non-gift-card remainder.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_card_redeem(
  _brand_id uuid,
  _code text,
  _appointment_id uuid,
  _client_id uuid,
  _amount numeric
) RETURNS TABLE(applied numeric, remaining numeric, gift_card_id uuid, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  g public.gift_cards%ROWTYPE;
  v_apply numeric;
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::uuid, 'forbidden'::text;
    RETURN;
  END IF;

  SELECT * INTO g FROM public.gift_cards c
  WHERE c.brand_id = _brand_id
    AND public.gift_card_normalize_code(c.code) = public.gift_card_normalize_code(_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::uuid, 'not_found'::text;
    RETURN;
  END IF;

  IF g.status = 'refunded' THEN
    RETURN QUERY SELECT NULL::numeric, g.remaining_amount, g.id, 'refunded'::text;
    RETURN;
  END IF;

  -- Live expiry check, not the stored status.
  IF g.expires_at IS NOT NULL AND g.expires_at <= now() THEN
    RETURN QUERY SELECT NULL::numeric, g.remaining_amount, g.id, 'expired'::text;
    RETURN;
  END IF;

  IF g.remaining_amount <= 0 THEN
    RETURN QUERY SELECT NULL::numeric, 0::numeric, g.id, 'no_balance'::text;
    RETURN;
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN QUERY SELECT NULL::numeric, g.remaining_amount, g.id, 'invalid_amount'::text;
    RETURN;
  END IF;

  -- Never over-apply: asking for more than the balance applies the balance,
  -- rather than failing. The caller shows what was actually applied.
  v_apply := LEAST(_amount, g.remaining_amount);

  UPDATE public.gift_cards
  SET remaining_amount = remaining_amount - v_apply,
      -- First redemption binds the card to whoever actually used it. Later
      -- redemptions leave it alone: the card belongs to its first redeemer,
      -- while each redemption row records that visit's client.
      client_id = COALESCE(client_id, _client_id),
      status = CASE WHEN remaining_amount - v_apply <= 0 THEN 'redeemed'::public.gift_card_status
                    ELSE status END,
      updated_at = now()
  WHERE id = g.id;

  INSERT INTO public.gift_card_redemptions(
    gift_card_id, brand_id, appointment_id, client_id, amount, currency, redeemed_by)
  VALUES (g.id, _brand_id, _appointment_id, _client_id, v_apply, g.currency, auth.uid());

  RETURN QUERY SELECT v_apply, g.remaining_amount - v_apply, g.id, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Owner report: expired cards that still hold value.
--
-- Section 11 is explicit that nothing happens automatically to these — this
-- exists purely so the Owner can see them and decide case by case. Computed
-- live for the same reason effective_status is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_cards_expired_with_balance(_brand_id uuid)
RETURNS TABLE(
  id uuid, code text, initial_amount numeric, remaining_amount numeric,
  currency text, expires_at timestamptz, client_id uuid, client_name text,
  location_name text, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT g.id, g.code, g.initial_amount, g.remaining_amount, g.currency,
         g.expires_at, g.client_id, c.name, l.name, g.created_at
  FROM public.gift_cards g
  LEFT JOIN public.clients c   ON c.id = g.client_id
  LEFT JOIN public.locations l ON l.id = g.location_id
  WHERE g.brand_id = _brand_id
    AND g.expires_at IS NOT NULL
    AND g.expires_at <= now()
    AND g.remaining_amount > 0
    AND g.status <> 'refunded'
  ORDER BY g.expires_at DESC;
END $function$;

-- ---------------------------------------------------------------------------
-- Grants. Called from the browser, so `authenticated` needs EXECUTE — the
-- auth.uid() checks inside each function are what enforce access.
-- gift_card_generate_code is internal only: exposing it would let anyone mint
-- codes and probe for collisions.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gift_card_generate_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_card_generate_code() TO service_role;

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('gift_card_sell','gift_card_lookup','gift_card_redeem',
                        'gift_cards_expired_with_balance','gift_card_normalize_code')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
