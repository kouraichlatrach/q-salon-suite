-- Gift Cards (Section 11) — schema.
--
-- Stored monetary value, sold by staff in-salon, redeemable against anything.
-- Deliberately NOT tied to a client at purchase: a gift card is a gift, so the
-- buyer usually isn't the redeemer and often doesn't know who will be. The
-- card links to a `clients` row only at first redemption (Section 11 item 4).
--
-- Redemption scope is fully unrestricted per spec — no category limits. A
-- future "restrict to category X" need is a discount/voucher feature, not
-- something to bolt on here.

-- ---------------------------------------------------------------------------
-- Status.
--
-- 'expired' exists for completeness, but nothing may *rely* on it being set:
-- expiry is always derived live from expires_at at the moment it matters. A
-- stored flag would need a background job to stay true, and a card that had
-- silently expired would still read as 'active' until that job ran. Same
-- "trust a live query over stale state" rule the deposit-hold expiry and the
-- WhatsApp reminder sweep already follow (Section 4 bug class 8).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.gift_card_status AS ENUM
    ('active','expired','redeemed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.gift_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- Where it was sold. Needed because income is logged per location, and the
  -- existing income RLS policies are keyed on location access.
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  -- Globally unique, not per-brand: staff read these aloud and type them by
  -- hand, and a code that means different things at different brands is a
  -- support incident waiting to happen. Lookups are still brand-scoped so one
  -- brand can never redeem another's card.
  code            text NOT NULL UNIQUE,
  initial_amount  numeric(12,2) NOT NULL CHECK (initial_amount > 0),
  remaining_amount numeric(12,2) NOT NULL CHECK (remaining_amount >= 0),
  currency        text NOT NULL DEFAULT 'QAR',
  -- NULL means "never expires" — the Owner may legitimately disable expiry,
  -- and per Section 11 that may in fact be required by local consumer law.
  expires_at      timestamptz,
  status          public.gift_card_status NOT NULL DEFAULT 'active',
  -- Set at first redemption, not at purchase (Section 11 item 4).
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  sold_by         uuid,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Balance can never exceed what was originally loaded.
  CONSTRAINT gift_cards_balance_chk CHECK (remaining_amount <= initial_amount)
);

CREATE INDEX IF NOT EXISTS gift_cards_brand_idx ON public.gift_cards (brand_id);
CREATE INDEX IF NOT EXISTS gift_cards_client_idx ON public.gift_cards (client_id);
-- Drives the "expired with remaining balance" Owner report.
CREATE INDEX IF NOT EXISTS gift_cards_expiry_idx
  ON public.gift_cards (brand_id, expires_at)
  WHERE remaining_amount > 0;

-- ---------------------------------------------------------------------------
-- Redemption events.
--
-- One row per application of a card against an appointment. Partial redemption
-- is the norm (Section 11: 200 QAR card against a 90 QAR service), and a card
-- is usable across multiple visits until the balance hits zero, so this is
-- explicitly one-to-many.
--
-- client_id is recorded per redemption as well as on the card, because the
-- card's own client_id is only the *first* redeemer. Whoever actually used it
-- on a given visit is the question this table answers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_redemptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id   uuid NOT NULL REFERENCES public.gift_cards(id) ON DELETE CASCADE,
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- Plain uuid, not an FK: this is a financial audit trail and must outlive
  -- the appointment it describes, same reasoning as payment_events (Section 4).
  appointment_id uuid,
  client_id      uuid,
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  currency       text NOT NULL DEFAULT 'QAR',
  redeemed_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_card_redemptions_card_idx
  ON public.gift_card_redemptions (gift_card_id);
CREATE INDEX IF NOT EXISTS gift_card_redemptions_appt_idx
  ON public.gift_card_redemptions (appointment_id);

-- ---------------------------------------------------------------------------
-- Brand-level configuration, matching the existing settings pattern
-- (min_notice_hours, reminder_lead_hours, …).
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands
  -- Suggested quick-pick amounts. Custom amounts are always allowed too
  -- (Section 11 item 1), so this is a convenience list, never a constraint.
  ADD COLUMN IF NOT EXISTS gift_card_denominations numeric(12,2)[] NOT NULL
    DEFAULT ARRAY[100,200,500]::numeric(12,2)[],
  ADD COLUMN IF NOT EXISTS gift_card_expiry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_card_expiry_months integer NOT NULL DEFAULT 12;

DO $$ BEGIN
  ALTER TABLE public.brands ADD CONSTRAINT brands_gift_card_expiry_months_chk
    CHECK (gift_card_expiry_months BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Expiry defaults to DISABLED. Section 11 flags that gift card expiry is more
-- likely than package expiry to collide with local consumer-protection rules,
-- since a gift card is money already paid in full. Defaulting it on would mean
-- every brand silently starts expiring prepaid balances before the Owner has
-- confirmed that is legal for them.

-- ---------------------------------------------------------------------------
-- Income: allow a record not tied to an appointment.
--
-- A gift card sale is real money through the till, but it has no appointment —
-- income_records.appointment_id was NOT NULL, so this had to be relaxed. The
-- CHECK below keeps every row anchored to *something*, so the column can't
-- quietly become optional for ordinary appointment income.
-- ---------------------------------------------------------------------------
ALTER TABLE public.income_records
  ALTER COLUMN appointment_id DROP NOT NULL;

ALTER TABLE public.income_records
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'appointment',
  ADD COLUMN IF NOT EXISTS gift_card_id uuid REFERENCES public.gift_cards(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.income_records ADD CONSTRAINT income_records_source_chk
    CHECK (
      (source = 'appointment'    AND appointment_id IS NOT NULL) OR
      (source = 'gift_card_sale' AND gift_card_id   IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS income_records_gift_card_idx
  ON public.income_records (gift_card_id) WHERE gift_card_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS. Mirrors income_records: Owner sees the whole brand, managers and
-- receptionists see their own locations, Staff/Technicians see nothing —
-- gift card balances are commercial data, not something a technician needs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_cards_read ON public.gift_cards;
CREATE POLICY gift_cards_read ON public.gift_cards
  FOR SELECT TO authenticated USING (
    public.is_brand_owner(auth.uid(), brand_id)
    OR ((public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist'))
        AND public.has_location_access(auth.uid(), location_id))
  );

DROP POLICY IF EXISTS gift_card_redemptions_read ON public.gift_card_redemptions;
CREATE POLICY gift_card_redemptions_read ON public.gift_card_redemptions
  FOR SELECT TO authenticated USING (
    public.is_brand_owner(auth.uid(), brand_id)
    OR public.is_brand_member(auth.uid(), brand_id)
  );

-- No INSERT/UPDATE policies on purpose: every write goes through the
-- SECURITY DEFINER RPCs in the next migration, which enforce the balance and
-- expiry rules atomically. Direct table writes would let a client-side bug
-- decrement a balance without recording the redemption that justified it.
