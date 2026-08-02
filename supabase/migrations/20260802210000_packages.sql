-- Packages (Section 11) — schema.
--
-- Multi-service bundles a client pre-pays for and redeems over future visits
-- ("Bridal Package: 1 haircut + 2 facials + 1 manicure"). Each included service
-- carries its own independent remaining count — deliberately not a
-- single-service model (Section 11 item 1).
--
-- The money model is identical to gift cards: revenue is recognised once, at
-- the sale, because that is when the money arrives. Redemption debits a
-- session and records why, but never logs income again. See package_redeem in
-- the RPC migration for the full reasoning.

-- ---------------------------------------------------------------------------
-- Status types.
--
-- As with gift_card_status, 'expired' exists for completeness but nothing may
-- *rely* on it being set. Expiry is always derived live from expires_at at the
-- moment it matters, because a stored flag needs a background job to stay true
-- and would read 'active' for a package that had silently lapsed. Section 4
-- bug class 8, and the same rule the deposit-hold expiry already follows.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.package_type_status AS ENUM ('active','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.client_package_status AS ENUM ('active','expired','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Package definitions (the Owner's catalogue).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.package_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  price         numeric(12,2) NOT NULL CHECK (price > 0),
  currency      text NOT NULL DEFAULT 'QAR',
  -- NULL means "never expires". Per Section 11 item 2 this is configured per
  -- package *type*, not per individual sale, and is stamped onto the purchase
  -- at the moment of sale so a later settings change cannot retroactively
  -- expire packages already sold.
  expiry_months integer CHECK (expiry_months IS NULL OR expiry_months BETWEEN 1 AND 120),
  status        public.package_type_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_types_brand_idx ON public.package_types (brand_id);

DROP TRIGGER IF EXISTS trg_package_types_updated_at ON public.package_types;
CREATE TRIGGER trg_package_types_updated_at BEFORE UPDATE ON public.package_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Line items on a definition: which services, and how many of each.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.package_services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type_id uuid NOT NULL REFERENCES public.package_types(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  included_count  integer NOT NULL CHECK (included_count > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One line per service. Two lines for the same service would split a single
  -- balance across two rows and make "3 of 5 remaining" ambiguous.
  UNIQUE (package_type_id, service_id)
);

CREATE INDEX IF NOT EXISTS package_services_type_idx
  ON public.package_services (package_type_id);

-- ---------------------------------------------------------------------------
-- A purchase.
--
-- price_paid and currency are snapshotted rather than read back through
-- package_type_id: the Owner may reprice a package after it has been sold, and
-- a refund must return what the client actually paid, not what the package
-- happens to cost today. Reading the live price at refund time would be a
-- money bug that only appears after the first repricing.
--
-- location_id is recorded because income is logged per location and the
-- existing income RLS policies are keyed on location access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  -- RESTRICT, not CASCADE: a sold package is a financial record. Deleting the
  -- definition must not silently erase what a client bought.
  package_type_id uuid NOT NULL REFERENCES public.package_types(id) ON DELETE RESTRICT,
  price_paid      numeric(12,2) NOT NULL CHECK (price_paid > 0),
  currency        text NOT NULL DEFAULT 'QAR',
  purchased_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  status          public.client_package_status NOT NULL DEFAULT 'active',
  sold_by         uuid,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_packages_brand_idx ON public.client_packages (brand_id);
CREATE INDEX IF NOT EXISTS client_packages_client_idx ON public.client_packages (client_id);
-- Drives the "expired with sessions left" Owner report and the profile flag.
CREATE INDEX IF NOT EXISTS client_packages_expiry_idx
  ON public.client_packages (brand_id, expires_at);

DROP TRIGGER IF EXISTS trg_client_packages_updated_at ON public.client_packages;
CREATE TRIGGER trg_client_packages_updated_at BEFORE UPDATE ON public.client_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Remaining sessions, per service, per purchase.
--
-- included_count is copied from the definition at purchase time alongside
-- remaining_count. Both are needed: the redemption UI shows "2 of 3 remaining"
-- (Section 11 item 4), and reading the original count back from
-- package_services would report today's definition rather than what this
-- client actually bought.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_package_service_balances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_package_id  uuid NOT NULL REFERENCES public.client_packages(id) ON DELETE CASCADE,
  service_id         uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  included_count     integer NOT NULL CHECK (included_count > 0),
  remaining_count    integer NOT NULL CHECK (remaining_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_package_id, service_id),
  -- Can never have more left than was bought.
  CONSTRAINT client_package_balance_chk CHECK (remaining_count <= included_count)
);

CREATE INDEX IF NOT EXISTS client_package_balances_pkg_idx
  ON public.client_package_service_balances (client_package_id);
CREATE INDEX IF NOT EXISTS client_package_balances_service_idx
  ON public.client_package_service_balances (service_id);

DROP TRIGGER IF EXISTS trg_client_package_balances_updated_at
  ON public.client_package_service_balances;
CREATE TRIGGER trg_client_package_balances_updated_at
  BEFORE UPDATE ON public.client_package_service_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Redemption events — one row per session consumed.
--
-- appointment_id is a plain uuid, not an FK: this is a financial audit trail
-- and must outlive the appointment it describes, the same rule payment_events
-- and gift_card_redemptions already follow (Section 4 bug class 4 fallout).
--
-- covered_amount records what the session was worth at the moment it was
-- redeemed, computed from the service's effective price at that location. The
-- package price does not divide evenly across services, so this is the only
-- honest record of the value a given redemption actually displaced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.package_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_package_id uuid NOT NULL REFERENCES public.client_packages(id) ON DELETE CASCADE,
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  service_id        uuid,
  appointment_id    uuid,
  client_id         uuid,
  covered_amount    numeric(12,2) NOT NULL DEFAULT 0 CHECK (covered_amount >= 0),
  currency          text NOT NULL DEFAULT 'QAR',
  redeemed_by       uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_redemptions_pkg_idx
  ON public.package_redemptions (client_package_id);
CREATE INDEX IF NOT EXISTS package_redemptions_appt_idx
  ON public.package_redemptions (appointment_id);

-- ---------------------------------------------------------------------------
-- Booking-time intent.
--
-- Section 11 item 4 asks for package detection "during booking or at checkout".
-- Detection happens at both; the *debit* happens only at checkout. Decrementing
-- a session at booking time would burn it on any appointment later cancelled or
-- no-showed, and would need a reversal path to undo — exactly the kind of
-- compensating-write complexity Section 4 bug class 3 warns about.
--
-- So this column records intent only: "this booking is expected to be covered
-- by that package". It debits nothing. Checkout pre-selects it, and
-- appointment_settle performs the single real decrement.
-- ---------------------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS client_package_id uuid
    REFERENCES public.client_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_client_package_idx
  ON public.appointments (client_package_id) WHERE client_package_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Income: package sales and refunds.
--
-- A package sale is money through the till with no appointment attached, the
-- same shape as a gift card sale. The source CHECK is rebuilt rather than
-- extended in place because CHECK constraints cannot be altered.
--
-- 'package_refund' rows carry a NEGATIVE amount — a contra entry that reverses
-- the original sale. income_records.amount has no positivity constraint, and a
-- reversing row is preferable to deleting or mutating the original: the sale
-- genuinely happened, and an append-only trail is what every other money table
-- in this project already does.
-- ---------------------------------------------------------------------------
ALTER TABLE public.income_records
  ADD COLUMN IF NOT EXISTS client_package_id uuid
    REFERENCES public.client_packages(id) ON DELETE SET NULL;

ALTER TABLE public.income_records DROP CONSTRAINT IF EXISTS income_records_source_chk;
ALTER TABLE public.income_records ADD CONSTRAINT income_records_source_chk
  CHECK (
    (source = 'appointment'    AND appointment_id    IS NOT NULL) OR
    (source = 'gift_card_sale' AND gift_card_id      IS NOT NULL) OR
    (source IN ('package_sale','package_refund')
                               AND client_package_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS income_records_client_package_idx
  ON public.income_records (client_package_id) WHERE client_package_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Definitions (package_types / package_services) follow `services`: readable by
-- any brand member, managed by the Owner. They are a catalogue, not money
-- movement, so ordinary RLS is the right tool and no RPC is needed.
--
-- Purchases, balances and redemptions follow `gift_cards`: Owner sees the whole
-- brand, managers and receptionists see their own locations, Staff/Technicians
-- see nothing — what a client has prepaid is commercial data a technician has
-- no need for.
-- ---------------------------------------------------------------------------
ALTER TABLE public.package_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_package_service_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_redemptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_services TO authenticated;
GRANT SELECT ON public.client_packages TO authenticated;
GRANT SELECT ON public.client_package_service_balances TO authenticated;
GRANT SELECT ON public.package_redemptions TO authenticated;
GRANT ALL ON public.package_types, public.package_services, public.client_packages,
             public.client_package_service_balances, public.package_redemptions
  TO service_role;

DROP POLICY IF EXISTS package_types_read ON public.package_types;
CREATE POLICY package_types_read ON public.package_types
  FOR SELECT TO authenticated USING (public.is_brand_member(auth.uid(), brand_id));

DROP POLICY IF EXISTS package_types_manage ON public.package_types;
CREATE POLICY package_types_manage ON public.package_types
  FOR ALL TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id))
  WITH CHECK (public.is_brand_owner(auth.uid(), brand_id));

DROP POLICY IF EXISTS package_services_read ON public.package_services;
CREATE POLICY package_services_read ON public.package_services
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.package_types t
            WHERE t.id = package_type_id AND public.is_brand_member(auth.uid(), t.brand_id))
  );

DROP POLICY IF EXISTS package_services_manage ON public.package_services;
CREATE POLICY package_services_manage ON public.package_services
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.package_types t
            WHERE t.id = package_type_id AND public.is_brand_owner(auth.uid(), t.brand_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.package_types t
            WHERE t.id = package_type_id AND public.is_brand_owner(auth.uid(), t.brand_id))
  );

DROP POLICY IF EXISTS client_packages_read ON public.client_packages;
CREATE POLICY client_packages_read ON public.client_packages
  FOR SELECT TO authenticated USING (
    public.is_brand_owner(auth.uid(), brand_id)
    OR ((public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist'))
        AND public.has_location_access(auth.uid(), location_id))
  );

DROP POLICY IF EXISTS client_package_balances_read ON public.client_package_service_balances;
CREATE POLICY client_package_balances_read ON public.client_package_service_balances
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.client_packages p
      WHERE p.id = client_package_id
        AND (
          public.is_brand_owner(auth.uid(), p.brand_id)
          OR ((public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist'))
              AND public.has_location_access(auth.uid(), p.location_id))
        )
    )
  );

DROP POLICY IF EXISTS package_redemptions_read ON public.package_redemptions;
CREATE POLICY package_redemptions_read ON public.package_redemptions
  FOR SELECT TO authenticated USING (
    public.is_brand_owner(auth.uid(), brand_id)
    OR public.is_brand_member(auth.uid(), brand_id)
  );

-- No INSERT/UPDATE policies on purchases, balances or redemptions, on purpose:
-- every write goes through the SECURITY DEFINER RPCs in the next migration,
-- which enforce the expiry, balance and refund rules atomically. Direct table
-- writes would let a client-side bug decrement a session without recording the
-- redemption that justified it — or refund a package that had already been used.
