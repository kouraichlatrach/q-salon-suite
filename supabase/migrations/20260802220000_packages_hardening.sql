-- Packages — hardening pass.
--
-- Review findings on the shipped Packages module. No behaviour change for a
-- correctly-behaving caller; every item here closes a gap between what the
-- code enforces and what its own comments claim it enforces.

-- ---------------------------------------------------------------------------
-- 1. service_effective_price must not be reachable from the browser.
--
-- It is SECURITY DEFINER, so it bypasses RLS by definition, and it takes an
-- arbitrary service_id with no brand check — meaning any signed-in user of any
-- tenant could read any other brand's per-location pricing by guessing or
-- harvesting a service UUID. Nothing in the UI calls it: the only callers are
-- client_packages_for_service and package_redeem, both SECURITY DEFINER
-- themselves, which reach it regardless of the caller's own rights.
--
-- Same reasoning that keeps gift_card_generate_code internal.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.service_effective_price(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_effective_price(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. package_redemptions was readable by Staff/Technicians.
--
-- The policy read `is_brand_owner(...) OR is_brand_member(...)`, which is just
-- `is_brand_member` — the first branch is a subset of the second. That
-- contradicts the comment directly above it in the schema migration ("Staff/
-- Technicians see nothing — what a client has prepaid is commercial data a
-- technician has no need for") and is inconsistent with client_packages and
-- client_package_service_balances, which both exclude staff correctly.
--
-- A redemption row exposes which client prepaid, for what, and what it was
-- worth. Aligned here with the tables it describes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS package_redemptions_read ON public.package_redemptions;
CREATE POLICY package_redemptions_read ON public.package_redemptions
  FOR SELECT TO authenticated USING (
    public.is_brand_member(auth.uid(), brand_id)
    AND NOT public.has_role(auth.uid(), 'staff')
  );

-- ---------------------------------------------------------------------------
-- 3. package_sell did not verify the location belongs to the brand.
--
-- can_manage_location() proves the caller manages the location, and the
-- package/client lookups prove those belong to _brand_id — but nothing tied
-- the location to the same brand. A caller managing a location in brand B
-- could pass brand A's package and client, producing a client_packages row
-- (and an income_records row) whose brand_id and location_id belong to
-- different tenants, polluting the other brand's reports.
--
-- Exploiting it needs two guessed UUIDs, so this is an integrity invariant
-- rather than a live vulnerability — but it is one cheap condition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_sell(
  _brand_id uuid,
  _location_id uuid,
  _client_id uuid,
  _package_type_id uuid,
  _method public.payment_method,
  _note text DEFAULT NULL
) RETURNS TABLE(client_package_id uuid, expires_at timestamptz, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  t public.package_types%ROWTYPE;
  v_id uuid;
  v_expires timestamptz;
  v_lines int;
BEGIN
  IF NOT public.can_manage_location(auth.uid(), _location_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'forbidden'::text;
    RETURN;
  END IF;

  -- The location must belong to the brand being sold on behalf of, or the
  -- purchase and its income record straddle two tenants.
  IF NOT EXISTS (SELECT 1 FROM public.locations l
                 WHERE l.id = _location_id AND l.brand_id = _brand_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'forbidden'::text;
    RETURN;
  END IF;

  SELECT * INTO t FROM public.package_types p
  WHERE p.id = _package_type_id AND p.brand_id = _brand_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'unknown_package'::text;
    RETURN;
  END IF;

  -- An inactive definition is withdrawn from sale. Existing purchases of it
  -- stay valid and redeemable — only new sales are blocked.
  IF t.status <> 'active'::public.package_type_status THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'package_inactive'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients c
                 WHERE c.id = _client_id AND c.brand_id = _brand_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'unknown_client'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_lines FROM public.package_services ps
  WHERE ps.package_type_id = _package_type_id;

  -- A package with no services is not sellable: the client would pay for
  -- nothing and there would be no balance to redeem against.
  IF v_lines = 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'package_empty'::text;
    RETURN;
  END IF;

  -- Expiry is stamped at purchase from the definition in force *now*, so a
  -- later change to expiry_months cannot retroactively expire packages already
  -- sold (Section 11 item 2).
  IF t.expiry_months IS NOT NULL THEN
    v_expires := now() + make_interval(months => t.expiry_months);
  ELSE
    v_expires := NULL;
  END IF;

  INSERT INTO public.client_packages(
    brand_id, location_id, client_id, package_type_id, price_paid, currency,
    expires_at, status, sold_by, note)
  VALUES (_brand_id, _location_id, _client_id, _package_type_id, t.price,
          COALESCE(t.currency, 'QAR'), v_expires, 'active', auth.uid(),
          NULLIF(btrim(COALESCE(_note, '')), ''))
  RETURNING id INTO v_id;

  -- Balances are copied from the template, not referenced through it: what the
  -- client bought is fixed at purchase time, even if the definition changes.
  INSERT INTO public.client_package_service_balances(
    client_package_id, service_id, included_count, remaining_count)
  SELECT v_id, ps.service_id, ps.included_count, ps.included_count
  FROM public.package_services ps
  WHERE ps.package_type_id = _package_type_id;

  -- Revenue is recognised HERE, at the sale, because this is when the money
  -- arrives. Redemption deliberately does not log income again — see
  -- package_redeem for why that would double-count. Identical rule to
  -- gift_card_sell.
  INSERT INTO public.income_records(
    appointment_id, location_id, brand_id, amount, currency,
    method, collected_by, source, client_package_id)
  VALUES (NULL, _location_id, _brand_id, t.price, COALESCE(t.currency, 'QAR'),
          _method, auth.uid(), 'package_sale', v_id);

  RETURN QUERY SELECT v_id, v_expires, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- 4. The expired-packages report was broader than the table it reports on.
--
-- client_packages RLS scopes managers and receptionists to their own
-- locations, but this report is SECURITY DEFINER and only checked brand
-- membership — so it read across every location in the brand, becoming a way
-- around the very policy that governs the underlying rows.
--
-- Realigned with client_packages_read. Owners still see the whole brand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.packages_expired_with_balance(_brand_id uuid)
RETURNS TABLE(
  client_package_id uuid, package_name text, client_id uuid, client_name text,
  location_name text, expires_at timestamptz, price_paid numeric, currency text,
  total_remaining int, total_included int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cp.id, t.name, cp.client_id, c.name, l.name, cp.expires_at,
         cp.price_paid, cp.currency,
         SUM(b.remaining_count)::int, SUM(b.included_count)::int
  FROM public.client_packages cp
  JOIN public.package_types t ON t.id = cp.package_type_id
  JOIN public.client_package_service_balances b ON b.client_package_id = cp.id
  LEFT JOIN public.clients c ON c.id = cp.client_id
  LEFT JOIN public.locations l ON l.id = cp.location_id
  WHERE cp.brand_id = _brand_id
    AND cp.expires_at IS NOT NULL
    AND cp.expires_at <= now()
    AND cp.status <> 'refunded'::public.client_package_status
    -- Mirrors the client_packages_read policy, so the report cannot show rows
    -- the caller could not read directly.
    AND (
      public.is_brand_owner(auth.uid(), _brand_id)
      OR public.has_location_access(auth.uid(), cp.location_id)
    )
  GROUP BY cp.id, t.name, c.name, l.name
  HAVING SUM(b.remaining_count) > 0
  ORDER BY cp.expires_at DESC;
END $function$;

REVOKE ALL ON FUNCTION public.packages_expired_with_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.packages_expired_with_balance(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_sell(
  uuid, uuid, uuid, uuid, public.payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.package_sell(
  uuid, uuid, uuid, uuid, public.payment_method, text) TO authenticated, service_role;
