-- Packages — RPC layer.
--
-- Same division as Gift Cards, Payments and WhatsApp: the database owns the
-- money rules, the UI only asks. Every balance change happens inside one of
-- these functions so a session can never be decremented without the redemption
-- row that justifies it (Section 4 bug class 3).
--
-- Called from the browser as `authenticated`, so these are SECURITY DEFINER
-- *with an explicit auth.uid() check inside* — the check is the access control,
-- since RLS is bypassed by definition here.

-- ---------------------------------------------------------------------------
-- Effective price of a service at a location.
--
-- Factored out because three separate paths need the same number — the
-- redemption preview, the redemption itself, and the client-profile summary —
-- and Section 9's UX fix #4 is explicit that a money rule implemented twice
-- will eventually disagree with itself. The UI never recomputes this.
--
-- STABLE, not IMMUTABLE: it reads table state that changes between statements.
-- (Section 4 bug class 8 — a wrong volatility label here would let the planner
-- fold a stale price into a later query.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_effective_price(
  _service_id uuid,
  _location_id uuid
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(slp.price, s.default_price)
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.id = _service_id;
$function$;

-- ---------------------------------------------------------------------------
-- Sale.
--
-- Creates the purchase, copies the definition's line items into per-service
-- balances, and logs the income — all in one transaction. Money physically
-- changed hands, so if any part fails the purchase must not exist either.
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
-- Detection: which of this client's packages can cover this service?
--
-- Drives the "Redeem from package (X of Y remaining)" default at both booking
-- and checkout (Section 11 item 4). Expiry is filtered live against now()
-- rather than read from the stored status, so a package that lapsed since it
-- was sold disappears from the offer without any job having run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_packages_for_service(
  _brand_id uuid,
  _client_id uuid,
  _service_id uuid,
  _location_id uuid DEFAULT NULL
) RETURNS TABLE(
  client_package_id uuid, package_name text, remaining_count int,
  included_count int, expires_at timestamptz, covers_amount numeric, currency text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cp.id, t.name, b.remaining_count, b.included_count, cp.expires_at,
         COALESCE(public.service_effective_price(_service_id, _location_id), 0),
         cp.currency
  FROM public.client_packages cp
  JOIN public.client_package_service_balances b ON b.client_package_id = cp.id
  JOIN public.package_types t ON t.id = cp.package_type_id
  WHERE cp.brand_id = _brand_id
    AND cp.client_id = _client_id
    AND b.service_id = _service_id
    AND b.remaining_count > 0
    AND cp.status = 'active'::public.client_package_status
    -- Live expiry check, never the stored status.
    AND (cp.expires_at IS NULL OR cp.expires_at > now())
  -- Soonest-expiring first: if a client holds two packages covering the same
  -- service, spending the one that lapses first is what a reasonable
  -- receptionist would do, and avoids stranding value.
  ORDER BY cp.expires_at ASC NULLS LAST, cp.purchased_at ASC;
END $function$;

-- ---------------------------------------------------------------------------
-- Redemption.
--
-- Internal only — see the grants at the bottom. The single legitimate caller is
-- appointment_settle, because a decremented session and a completed
-- appointment must succeed or fail together (Section 4 bug class 3). Exposing
-- this to the browser would reintroduce exactly the split that made gift card
-- redemption dangerous before appointment_settle existed. This is deliberately
-- tighter than gift_card_redeem, which is reachable directly.
--
-- SELECT ... FOR UPDATE locks the balance row for the transaction. Without it
-- two concurrent checkouts could both read remaining_count = 1, both pass the
-- check, and both decrement — spending one session twice.
--
-- Deliberately does NOT write an income_record. The money was banked and
-- recognised when the package was sold; logging it again here would report the
-- same riyal as revenue twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_redeem(
  _brand_id uuid,
  _client_package_id uuid,
  _service_id uuid,
  _appointment_id uuid,
  _client_id uuid,
  _location_id uuid
) RETURNS TABLE(covered numeric, remaining int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  cp public.client_packages%ROWTYPE;
  b  public.client_package_service_balances%ROWTYPE;
  v_covered numeric;
BEGIN
  SELECT * INTO cp FROM public.client_packages p
  WHERE p.id = _client_package_id AND p.brand_id = _brand_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, 'package_not_found'::text;
    RETURN;
  END IF;

  IF cp.status = 'refunded'::public.client_package_status THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, 'package_refunded'::text;
    RETURN;
  END IF;

  -- The package belongs to a specific client. Redeeming one client's prepaid
  -- sessions against another client's visit would be theft of stored value.
  IF cp.client_id IS DISTINCT FROM _client_id THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, 'package_wrong_client'::text;
    RETURN;
  END IF;

  -- Live expiry check, not the stored status.
  IF cp.expires_at IS NOT NULL AND cp.expires_at <= now() THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, 'package_expired'::text;
    RETURN;
  END IF;

  SELECT * INTO b FROM public.client_package_service_balances sb
  WHERE sb.client_package_id = _client_package_id
    AND sb.service_id = _service_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::int, 'package_service_not_covered'::text;
    RETURN;
  END IF;

  IF b.remaining_count <= 0 THEN
    RETURN QUERY SELECT NULL::numeric, 0, 'package_no_sessions'::text;
    RETURN;
  END IF;

  -- What this session is worth, computed here rather than passed in, so the UI
  -- cannot disagree with the database about the money (Section 9 UX fix #4).
  v_covered := COALESCE(public.service_effective_price(_service_id, _location_id), 0);

  UPDATE public.client_package_service_balances
  SET remaining_count = remaining_count - 1, updated_at = now()
  WHERE id = b.id;

  INSERT INTO public.package_redemptions(
    client_package_id, brand_id, service_id, appointment_id, client_id,
    covered_amount, currency, redeemed_by)
  VALUES (_client_package_id, _brand_id, _service_id, _appointment_id, _client_id,
          v_covered, cp.currency, auth.uid());

  RETURN QUERY SELECT v_covered, b.remaining_count - 1, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Refund (Section 11 item 5).
--
-- Allowed only while nothing has been redeemed — across ALL services in the
-- bundle, not just the one being asked about. Once any session is used the
-- purchase is non-refundable and the goodwill path is extending expiry instead.
-- Proration was explicitly rejected in the spec.
--
-- The reversal is a negative income_record rather than a deletion or an edit:
-- the sale genuinely happened, and every other money table here is append-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_refund(
  _client_package_id uuid,
  _method public.payment_method DEFAULT NULL
) RETURNS TABLE(refunded_amount numeric, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  cp public.client_packages%ROWTYPE;
  v_used int;
  v_method public.payment_method;
BEGIN
  SELECT * INTO cp FROM public.client_packages p WHERE p.id = _client_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, 'package_not_found'::text;
    RETURN;
  END IF;

  -- Refunding money is an Owner/Manager decision, not a receptionist one.
  IF NOT (public.is_brand_owner(auth.uid(), cp.brand_id)
          OR (public.has_role(auth.uid(), 'manager'::public.app_role)
              AND public.has_location_access(auth.uid(), cp.location_id))) THEN
    RETURN QUERY SELECT NULL::numeric, 'forbidden'::text;
    RETURN;
  END IF;

  IF cp.status = 'refunded'::public.client_package_status THEN
    RETURN QUERY SELECT NULL::numeric, 'already_refunded'::text;
    RETURN;
  END IF;

  -- Counted inside the same transaction as the status flip, with the purchase
  -- row locked above: a redemption landing between the check and the write
  -- would otherwise let a used package be refunded in full.
  SELECT count(*) INTO v_used FROM public.package_redemptions r
  WHERE r.client_package_id = _client_package_id;

  IF v_used > 0 THEN
    RETURN QUERY SELECT NULL::numeric, 'package_partially_used'::text;
    RETURN;
  END IF;

  -- Default the reversal to the method the sale was logged under, so the books
  -- balance per method rather than moving money between cash and card.
  IF _method IS NOT NULL THEN
    v_method := _method;
  ELSE
    SELECT ir.method INTO v_method FROM public.income_records ir
    WHERE ir.client_package_id = _client_package_id AND ir.source = 'package_sale'
    ORDER BY ir.created_at ASC LIMIT 1;
    v_method := COALESCE(v_method, 'cash'::public.payment_method);
  END IF;

  UPDATE public.client_packages
  SET status = 'refunded'::public.client_package_status, updated_at = now()
  WHERE id = _client_package_id;

  -- Zero the balances so a refunded package cannot be offered at checkout even
  -- if some later read path forgets to filter on status.
  UPDATE public.client_package_service_balances
  SET remaining_count = 0, updated_at = now()
  WHERE client_package_id = _client_package_id;

  INSERT INTO public.income_records(
    appointment_id, location_id, brand_id, amount, currency,
    method, collected_by, source, client_package_id)
  VALUES (NULL, cp.location_id, cp.brand_id, -cp.price_paid, cp.currency,
          v_method, auth.uid(), 'package_refund', _client_package_id);

  RETURN QUERY SELECT cp.price_paid, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Goodwill expiry extension (Section 11 item 5, the non-refundable path).
--
-- A plain date change, deliberately — the spec rejected proration math in
-- favour of a discretionary human decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_extend_expiry(
  _client_package_id uuid,
  _new_expires_at timestamptz
) RETURNS TABLE(expires_at timestamptz, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE cp public.client_packages%ROWTYPE;
BEGIN
  SELECT * INTO cp FROM public.client_packages p WHERE p.id = _client_package_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::timestamptz, 'package_not_found'::text;
    RETURN;
  END IF;

  IF NOT (public.is_brand_owner(auth.uid(), cp.brand_id)
          OR (public.has_role(auth.uid(), 'manager'::public.app_role)
              AND public.has_location_access(auth.uid(), cp.location_id))) THEN
    RETURN QUERY SELECT NULL::timestamptz, 'forbidden'::text;
    RETURN;
  END IF;

  IF cp.status = 'refunded'::public.client_package_status THEN
    RETURN QUERY SELECT NULL::timestamptz, 'already_refunded'::text;
    RETURN;
  END IF;

  IF _new_expires_at IS NULL THEN
    RETURN QUERY SELECT NULL::timestamptz, 'invalid_date'::text;
    RETURN;
  END IF;

  -- Extending into the past would "extend" a package into being more expired.
  IF _new_expires_at <= now() THEN
    RETURN QUERY SELECT NULL::timestamptz, 'date_in_past'::text;
    RETURN;
  END IF;

  UPDATE public.client_packages
  SET expires_at = _new_expires_at,
      -- A package stored as 'expired' becomes live again. Status is not the
      -- authority on expiry, but leaving it stale would be misleading.
      status = 'active'::public.client_package_status,
      updated_at = now()
  WHERE id = _client_package_id;

  RETURN QUERY SELECT _new_expires_at, NULL::text;
END $function$;

-- ---------------------------------------------------------------------------
-- Client profile summary — every package this client holds.
--
-- Powers the staff-visible flag on /app/clients/:id, including the
-- expired-with-sessions-left case Section 11 item 3 asks for. effective_status
-- is derived live for the same reason gift_card_lookup derives its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_packages_overview(
  _brand_id uuid,
  _client_id uuid
) RETURNS TABLE(
  client_package_id uuid, package_name text, purchased_at timestamptz,
  expires_at timestamptz, status text, effective_status text,
  price_paid numeric, currency text,
  total_remaining int, total_included int, services jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.is_brand_member(auth.uid(), _brand_id)
     OR public.has_role(auth.uid(), 'staff'::public.app_role) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cp.id, t.name, cp.purchased_at, cp.expires_at,
         cp.status::text,
         CASE
           WHEN cp.status = 'refunded'::public.client_package_status THEN 'refunded'
           WHEN cp.expires_at IS NOT NULL AND cp.expires_at <= now() THEN 'expired'
           WHEN COALESCE(SUM(b.remaining_count), 0) <= 0 THEN 'used'
           ELSE 'active'
         END,
         cp.price_paid, cp.currency,
         COALESCE(SUM(b.remaining_count), 0)::int,
         COALESCE(SUM(b.included_count), 0)::int,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'service_id', b.service_id,
               'service_name', s.name,
               'remaining', b.remaining_count,
               'included', b.included_count
             ) ORDER BY s.name
           ) FILTER (WHERE b.id IS NOT NULL),
           '[]'::jsonb)
  FROM public.client_packages cp
  JOIN public.package_types t ON t.id = cp.package_type_id
  LEFT JOIN public.client_package_service_balances b ON b.client_package_id = cp.id
  LEFT JOIN public.services s ON s.id = b.service_id
  WHERE cp.brand_id = _brand_id AND cp.client_id = _client_id
  GROUP BY cp.id, t.name
  ORDER BY cp.purchased_at DESC;
END $function$;

-- ---------------------------------------------------------------------------
-- Owner report: expired packages that still hold unused sessions.
--
-- Section 11 item 3 is explicit that nothing happens to these automatically —
-- this exists purely so the Owner can decide case by case. Same shape and same
-- live-computation as gift_cards_expired_with_balance.
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
  GROUP BY cp.id, t.name, c.name, l.name
  HAVING SUM(b.remaining_count) > 0
  ORDER BY cp.expires_at DESC;
END $function$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- package_redeem is service_role only. Its only legitimate caller is
-- appointment_settle, which runs SECURITY DEFINER and so reaches it regardless
-- of the caller's own rights. Granting it to `authenticated` would let a
-- client-side bug — or a curious user — burn a prepaid session without
-- completing the appointment that justified it.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.package_redeem(uuid, uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.package_redeem(uuid, uuid, uuid, uuid, uuid, uuid)
  TO service_role;

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('package_sell','client_packages_for_service',
                        'package_refund','package_extend_expiry',
                        'client_packages_overview','packages_expired_with_balance',
                        'service_effective_price')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
