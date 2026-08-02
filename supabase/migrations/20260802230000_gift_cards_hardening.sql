-- Gift Cards — hardening pass.
--
-- The Packages review (20260802220000) found three tenant-isolation gaps that
-- Gift Cards shares, having been written first and copied from. This applies
-- the same fixes here, plus one that is specific to Gift Cards.
--
-- No behaviour change for a correctly-behaving caller. Every item closes a gap
-- between what the code enforces and what the module's own comments claim.

-- ---------------------------------------------------------------------------
-- 1. gift_card_redemptions was readable by Staff/Technicians.
--
-- The policy read `is_brand_owner(...) OR is_brand_member(...)`. The first
-- branch is a subset of the second, so the whole thing collapsed to plain
-- brand membership — which includes Staff/Technicians. That contradicts the
-- comment above it in the schema migration ("Staff/Technicians see nothing —
-- gift card balances are commercial data, not something a technician needs")
-- and is inconsistent with gift_cards_read directly above, which correctly
-- excludes staff and scopes by location.
--
-- A redemption row exposes which client redeemed, against which appointment,
-- and for how much.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS gift_card_redemptions_read ON public.gift_card_redemptions;
CREATE POLICY gift_card_redemptions_read ON public.gift_card_redemptions
  FOR SELECT TO authenticated USING (
    public.is_brand_member(auth.uid(), brand_id)
    AND NOT public.has_role(auth.uid(), 'staff')
  );

-- ---------------------------------------------------------------------------
-- 2. gift_card_lookup was missing the staff exclusion its siblings have.
--
-- gift_card_redeem and gift_cards_expired_with_balance both check
-- `is_brand_member AND NOT staff`; gift_card_lookup checked only membership.
-- So a Technician could read any card's balance, expiry and bound client from
-- its code — data the gift_cards RLS policy denies them on the table itself.
--
-- Lower severity than it looks, since it needs the code rather than being
-- enumerable, but it is the same commercial data the rest of the module is
-- careful about. Nothing legitimate breaks: the only caller is the checkout
-- dialog, and checkout goes through appointment_settle, which gates on
-- can_manage_location() — owner/manager/receptionist only. A Technician can
-- never complete the checkout this lookup feeds.
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
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
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
-- 3. gift_card_sell did not verify the location belongs to the brand.
--
-- can_manage_location() proves the caller manages the location, and the brands
-- lookup proves _brand_id exists — but nothing tied the two together. A caller
-- managing a location in brand B could pass brand A's id, producing a
-- gift_cards row and an income_records row whose brand_id and location_id
-- belong to different tenants, polluting the other brand's revenue reports.
--
-- Needs a guessed brand UUID to exploit, so this is an integrity invariant
-- rather than a live vulnerability — but it is one condition.
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

  -- The location must belong to the brand being sold on behalf of, or the card
  -- and its income record straddle two tenants.
  IF NOT EXISTS (SELECT 1 FROM public.locations l
                 WHERE l.id = _location_id AND l.brand_id = _brand_id) THEN
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
  -- settings change must not retroactively expire cards already sold.
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
  -- actually arrives. Redemption deliberately does not log income again.
  INSERT INTO public.income_records(
    appointment_id, location_id, brand_id, amount, currency,
    method, collected_by, source, gift_card_id)
  VALUES (NULL, _location_id, _brand_id, _amount, v_currency,
          _method, auth.uid(), 'gift_card_sale', v_id);

  RETURN QUERY SELECT v_id, v_code, v_expires, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- 4. The expired-cards report was broader than the table it reports on.
--
-- gift_cards RLS scopes managers and receptionists to their own locations, but
-- this report is SECURITY DEFINER and only checked brand membership — so it
-- read across every location in the brand, becoming a way around the very
-- policy that governs the underlying rows.
--
-- Realigned with gift_cards_read. Owners still see the whole brand.
--
-- Note this deliberately does NOT change gift_card_redeem, which stays
-- brand-scoped without a location check: a card sold at one branch is meant to
-- be redeemable at another, and the customer holding the code has no concept
-- of which branch sold it. Reading a report is not the same as honouring a
-- card presented at the counter.
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
    -- Mirrors the gift_cards_read policy, so the report cannot show rows the
    -- caller could not read directly.
    AND (
      public.is_brand_owner(auth.uid(), _brand_id)
      OR public.has_location_access(auth.uid(), g.location_id)
    )
  ORDER BY g.expires_at DESC;
END $function$;

-- Grants are unchanged from the original module; restated because CREATE OR
-- REPLACE on an existing function preserves them, but a future reader should
-- not have to check.
REVOKE ALL ON FUNCTION public.gift_card_lookup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_card_lookup(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gift_cards_expired_with_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_cards_expired_with_balance(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gift_card_sell(
  uuid, uuid, numeric, public.payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_card_sell(
  uuid, uuid, numeric, public.payment_method, text) TO authenticated, service_role;
