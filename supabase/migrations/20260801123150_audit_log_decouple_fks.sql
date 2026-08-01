-- Design flaw caught during test-data cleanup.
--
-- payment_events.payment_id / .appointment_id were FKs with ON DELETE SET NULL.
-- Deleting a payment or appointment therefore issued an UPDATE against
-- payment_events, which the append-only trigger correctly refused:
--   23514: payment_events is append-only (attempted UPDATE)
--
-- Net effect: once an appointment had *any* payment event, it could never be
-- deleted — not for a data-deletion request, not for cleaning test rows. The
-- two safeguards were fighting each other.
--
-- Resolution: an audit log should not FK-reference the mutable operational rows
-- it describes. The columns stay as plain uuids so history survives deletion of
-- what it refers to — which is the point of an audit log. Referential integrity
-- is not the guarantee we want here; immutability is.

ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_payment_id_fkey;
ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_appointment_id_fkey;

COMMENT ON COLUMN public.payment_events.payment_id IS
  'payments.id at time of writing. Intentionally NOT a foreign key: the audit log must outlive the rows it describes (an FK with ON DELETE SET NULL would require an UPDATE, which the append-only trigger blocks).';
COMMENT ON COLUMN public.payment_events.appointment_id IS
  'appointments.id at time of writing. Intentionally NOT a foreign key — see payment_id.';
