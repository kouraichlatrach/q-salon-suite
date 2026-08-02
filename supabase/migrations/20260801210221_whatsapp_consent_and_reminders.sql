-- WhatsApp Automation (Section 10) — schema.
--
-- Consent is modelled as a standing brand-wide preference on `clients`, per
-- Core Decision #4 and Section 10 item 2: a returning client who already opted
-- in is never re-asked. Deliberately NOT per-appointment.
--
-- Opt-in/opt-out are recorded with timestamps and a source, because this is a
-- Meta platform compliance requirement rather than a UX preference — if a
-- number is ever reported, the salon needs to show when and how consent was
-- obtained, and that an opt-out was honoured promptly.

-- ---------------------------------------------------------------------------
-- Consent on clients
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.consent_source AS ENUM
    ('public_booking','staff_booking','staff_manual','inbound_stop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at  timestamptz,
  -- Retained after an opt-out so we can prove the request was honoured, and
  -- when. Cleared opt-in alone would lose that evidence.
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_consent_source public.consent_source;

-- The reminder sweep filters on this constantly; keep it cheap.
CREATE INDEX IF NOT EXISTS clients_whatsapp_opt_in_idx
  ON public.clients (brand_id) WHERE whatsapp_opt_in;

-- ---------------------------------------------------------------------------
-- Reminder tracking on appointments
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointments
  -- Set once a reminder is successfully handed to the provider. The sweep
  -- requires this to be NULL, which is what prevents duplicate sends.
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- Partial index matching the sweep's predicate exactly: only future, still
-- scheduled, not-yet-reminded rows are ever candidates.
CREATE INDEX IF NOT EXISTS appointments_reminder_due_idx
  ON public.appointments (starts_at)
  WHERE status = 'scheduled' AND reminded_at IS NULL;

-- ---------------------------------------------------------------------------
-- Brand-level reminder configuration (Section 10: single Owner-configurable
-- lead time, 24h default; two-reminder support deliberately deferred)
-- ---------------------------------------------------------------------------

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS whatsapp_enabled            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_lead_hours         integer NOT NULL DEFAULT 24;

DO $$ BEGIN
  ALTER TABLE public.brands ADD CONSTRAINT brands_reminder_lead_chk
    CHECK (reminder_lead_hours BETWEEN 1 AND 168);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Message templates.
--
-- Business-initiated WhatsApp messages require Meta-approved templates in
-- production. Which template SID is used for which message type is therefore
-- configuration, not code — and it differs between the Twilio sandbox (which
-- ships its own fixed templates) and an approved production sender. Storing it
-- per brand means a brand can be migrated onto approved templates without a
-- deploy, and lets the sandbox be used meanwhile.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  -- 'booking_confirmation' | 'appointment_reminder'
  kind         text NOT NULL,
  -- Twilio Content SID (HX…). Null means "no approved template yet" — the
  -- adapter then falls back to a plain body, which only works inside an open
  -- 24-hour session window (i.e. sandbox/testing).
  content_sid  text,
  -- Human note: which sandbox/approved template this maps to, and its wording.
  description  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, kind)
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_templates_read_brand ON public.whatsapp_templates;
CREATE POLICY whatsapp_templates_read_brand ON public.whatsapp_templates
  FOR SELECT USING (
    public.is_brand_member(auth.uid(), brand_id)
    AND NOT public.has_role(auth.uid(), 'staff'::public.app_role)
  );

-- ---------------------------------------------------------------------------
-- Message log — one row per outbound attempt.
--
-- Serves three purposes: proving what was sent (compliance), preventing
-- accidental duplicates during development, and giving a real audit trail when
-- a client says "I never got it".
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- Plain uuids, not FKs: the log must outlive the rows it describes, same
  -- reasoning as payment_events (Section 4).
  appointment_id uuid,
  client_id      uuid,
  kind           text NOT NULL,
  to_phone       text NOT NULL,
  provider       text NOT NULL DEFAULT 'twilio',
  provider_sid   text,
  status         text NOT NULL,
  error_message  text,
  body_preview   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_appointment_idx
  ON public.whatsapp_messages (appointment_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_client_idx
  ON public.whatsapp_messages (client_id);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_messages_read_brand ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_read_brand ON public.whatsapp_messages
  FOR SELECT USING (
    public.is_brand_member(auth.uid(), brand_id)
    AND NOT public.has_role(auth.uid(), 'staff'::public.app_role)
  );
