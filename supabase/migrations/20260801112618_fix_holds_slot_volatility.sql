-- Correctness fix: appointment_holds_slot was declared IMMUTABLE but reads
-- now() to decide whether a pending hold has expired. IMMUTABLE promises the
-- planner that output depends only on the arguments, which licenses constant
-- folding and caching — meaning an expired hold could keep reading as "still
-- holding" (or vice versa) within a plan. STABLE is the correct volatility:
-- consistent within a single statement, re-evaluated across statements, which
-- is exactly the semantics check-on-read expiry needs.
CREATE OR REPLACE FUNCTION public.appointment_holds_slot(
  _status          public.appointment_status,
  _deposit_status  public.deposit_status,
  _hold_expires_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    _status <> 'cancelled'
    AND NOT (
      _deposit_status = 'pending'
      AND _hold_expires_at IS NOT NULL
      AND _hold_expires_at <= now()
    );
$$;
