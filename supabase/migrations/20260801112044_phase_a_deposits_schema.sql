-- Payments Phase A — Booking Deposits: schema.
-- Spec: Section 9, Phase A. Provider-agnostic by design: nothing here names
-- Dibsy, so the same tables back the Mock provider now and the real one later.
-- `provider` + `provider_ref` carry whatever the adapter reports.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Spec item 10. NULL on appointments.deposit_status means "no deposit applies"
-- to this booking, which keeps the enum to exactly the specced five states.
DO $$ BEGIN
  CREATE TYPE public.deposit_status AS ENUM
    ('pending','paid','refunded','forfeited','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_kind AS ENUM ('charge','refund');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_state AS ENUM
    ('pending','succeeded','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Deposit configuration per service (spec items 1 & 2)
-- ---------------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS deposit_required         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount           numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposit_percentage       numeric(5,2),
  -- mandatory = booking blocked without it; optional = client may skip (item 3)
  ADD COLUMN IF NOT EXISTS deposit_mandatory        boolean NOT NULL DEFAULT true,
  -- item 2: target new clients (no completed appointment history) specifically
  ADD COLUMN IF NOT EXISTS deposit_new_clients_only boolean NOT NULL DEFAULT false;

-- Owner picks flat OR percentage, never both, and must pick one if a deposit
-- is required at all.
DO $$ BEGIN
  ALTER TABLE public.services ADD CONSTRAINT services_deposit_shape_chk CHECK (
    NOT deposit_required
    OR ( (deposit_amount IS NOT NULL) <> (deposit_percentage IS NOT NULL) )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.services ADD CONSTRAINT services_deposit_range_chk CHECK (
    (deposit_amount IS NULL OR deposit_amount > 0)
    AND (deposit_percentage IS NULL OR (deposit_percentage > 0 AND deposit_percentage <= 100))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Brand-level deposit policy (spec items 5 & 8)
-- ---------------------------------------------------------------------------

ALTER TABLE public.brands
  -- item 8: short expiry window on the slot hold
  ADD COLUMN IF NOT EXISTS deposit_hold_minutes integer NOT NULL DEFAULT 15,
  -- item 5: same mental model as the existing min_notice_hours setting
  ADD COLUMN IF NOT EXISTS refund_cutoff_hours  integer NOT NULL DEFAULT 24;

DO $$ BEGIN
  ALTER TABLE public.brands ADD CONSTRAINT brands_deposit_policy_chk CHECK (
    deposit_hold_minutes BETWEEN 1 AND 1440
    AND refund_cutoff_hours BETWEEN 0 AND 720
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Deposit state on appointments (spec items 3, 4, 8)
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS deposit_status          public.deposit_status,
  -- amount the deposit rule computed as due
  ADD COLUMN IF NOT EXISTS deposit_amount          numeric(10,2),
  -- amount actually confirmed paid (webhook-confirmed only)
  ADD COLUMN IF NOT EXISTS deposit_paid_amount     numeric(10,2),
  -- item 8: the hold window. NULL once the deposit is resolved.
  ADD COLUMN IF NOT EXISTS deposit_hold_expires_at timestamptz,
  -- item 3: client declined an *optional* deposit -> staff-visible badge
  ADD COLUMN IF NOT EXISTS deposit_skipped         boolean NOT NULL DEFAULT false;

-- Availability queries filter heavily on live pending holds; keep that cheap.
CREATE INDEX IF NOT EXISTS appointments_pending_hold_idx
  ON public.appointments (staff_user_id, deposit_hold_expires_at)
  WHERE deposit_status = 'pending';

-- ---------------------------------------------------------------------------
-- Payments: charges and refunds (spec item 10)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  appointment_id    uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  kind              public.payment_kind  NOT NULL,
  state             public.payment_state NOT NULL DEFAULT 'pending',
  -- which adapter produced this row: 'mock' now, 'dibsy' later
  provider          text NOT NULL,
  -- the provider's own id for the charge/refund
  provider_ref      text,
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'QAR',
  -- Section 7: idempotency key on every payment-writing operation
  idempotency_key   text NOT NULL UNIQUE,
  -- refunds point back at the charge they reverse
  parent_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_appointment_idx ON public.payments (appointment_id);
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON public.payments (provider, provider_ref);

-- ---------------------------------------------------------------------------
-- Append-only audit log (cross-phase architecture requirement)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  appointment_id     uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  event_type         text NOT NULL,
  -- whether the inbound payload passed signature verification. Recorded even
  -- for rejects, so forged-webhook attempts leave a trail.
  signature_verified boolean,
  payload            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON public.payment_events (payment_id);
CREATE INDEX IF NOT EXISTS payment_events_appointment_idx ON public.payment_events (appointment_id);

-- Enforce append-only in the database, not just by convention: no UPDATE or
-- DELETE on the audit log, for anyone, including service_role.
CREATE OR REPLACE FUNCTION public.payment_events_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only (attempted %)', TG_OP
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS payment_events_no_mutate ON public.payment_events;
CREATE TRIGGER payment_events_no_mutate
  BEFORE UPDATE OR DELETE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();

-- ---------------------------------------------------------------------------
-- RLS. Payment rows are written by server-side SECURITY DEFINER RPCs only;
-- brand members get read access for the UI, nobody gets direct write.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Staff/technicians are excluded, matching the existing clients policy: money
-- records are Owner/Manager/Receptionist context, not per-technician.
DROP POLICY IF EXISTS payments_read_brand ON public.payments;
CREATE POLICY payments_read_brand ON public.payments
  FOR SELECT USING (
    public.is_brand_member(auth.uid(), brand_id)
    AND NOT public.has_role(auth.uid(), 'staff'::public.app_role)
  );

DROP POLICY IF EXISTS payment_events_read_brand ON public.payment_events;
CREATE POLICY payment_events_read_brand ON public.payment_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_events.payment_id
        AND public.is_brand_member(auth.uid(), p.brand_id)
        AND NOT public.has_role(auth.uid(), 'staff'::public.app_role)
    )
  );
