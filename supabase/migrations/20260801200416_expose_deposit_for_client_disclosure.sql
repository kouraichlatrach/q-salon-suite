-- Client-facing deposit disclosure.
--
-- A manual walkthrough of the booking flow found that a client is never told a
-- deposit is required until *after* phone verification, when they are suddenly
-- redirected to checkout. It reads as a bait-and-switch. The data to disclose
-- it earlier existed, but was never exposed to the client-facing surfaces.
--
-- Both functions below deliberately compute deposit figures in SQL rather than
-- letting the UI derive them. Money shown to a client must come from the same
-- place as money charged to them, or the two eventually disagree.

-- ---------------------------------------------------------------------------
-- Service list: enough to say "30% deposit required to book" up front.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.public_list_services(uuid, uuid);

CREATE OR REPLACE FUNCTION public.public_list_services(_brand_id uuid, _location_id uuid)
RETURNS TABLE(
  id uuid, name text, description text, category text,
  duration_minutes integer, price numeric, currency text,
  deposit_required boolean,
  deposit_mandatory boolean,
  -- When true the deposit only applies to clients with no completed visit, so
  -- the UI must hedge ("may be required") rather than state it flatly.
  deposit_new_clients_only boolean,
  deposit_percentage numeric,
  -- Authoritative figure, computed the same way public_resolve_deposit does.
  deposit_amount numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.id, s.name, s.description, s.category, s.duration_minutes,
         COALESCE(slp.price, s.default_price) AS price,
         COALESCE(slp.currency, s.currency)   AS currency,
         s.deposit_required,
         s.deposit_mandatory,
         s.deposit_new_clients_only,
         s.deposit_percentage,
         CASE
           WHEN NOT s.deposit_required THEN NULL
           WHEN s.deposit_amount IS NOT NULL THEN s.deposit_amount
           ELSE LEAST(
             round(COALESCE(slp.price, s.default_price) * s.deposit_percentage / 100.0, 2),
             COALESCE(slp.price, s.default_price)
           )
         END AS deposit_amount
  FROM public.services s
  LEFT JOIN public.service_location_prices slp
    ON slp.service_id = s.id AND slp.location_id = _location_id
  WHERE s.brand_id = _brand_id AND s.is_active = true
  ORDER BY s.category NULLS LAST, s.name;
$function$;

-- ---------------------------------------------------------------------------
-- Appointment by token: add the deposit breakdown, so the confirmation and
-- manage screens can show paid-vs-remaining instead of only the full price.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.public_get_appointment_by_token(text);

CREATE OR REPLACE FUNCTION public.public_get_appointment_by_token(_token text)
RETURNS TABLE(
  appointment_id uuid, brand_id uuid, brand_name text, brand_slug text,
  location_id uuid, location_name text, location_address text,
  service_id uuid, service_name text, duration_minutes integer,
  staff_user_id uuid, staff_name text, client_name text, phone text,
  starts_at timestamptz, ends_at timestamptz, status appointment_status,
  price numeric, currency text,
  deposit_status public.deposit_status,
  deposit_amount numeric,
  deposit_paid_amount numeric,
  -- Only a deposit still credited to the client reduces the balance; a
  -- forfeited or refunded one must not. Mirrors appointment_balance_due().
  balance_due numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT a.id, b.id, b.name, b.slug,
         l.id, l.name, l.address,
         s.id, s.name, s.duration_minutes,
         a.staff_user_id, COALESCE(p.full_name,'Staff'),
         c.name, c.phone, a.starts_at, a.ends_at, a.status,
         a.price, a.currency,
         a.deposit_status,
         a.deposit_amount,
         a.deposit_paid_amount,
         GREATEST(
           a.price - COALESCE(
             CASE WHEN a.deposit_status = 'paid' THEN a.deposit_paid_amount END, 0),
           0)
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  JOIN public.brands b       ON b.id = a.brand_id
  JOIN public.locations l    ON l.id = a.location_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.profiles p ON p.id = a.staff_user_id
  JOIN public.clients c      ON c.id = a.client_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now());
$function$;

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('public_list_services','public_get_appointment_by_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;
