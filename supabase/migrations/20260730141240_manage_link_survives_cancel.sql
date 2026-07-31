-- Spec correction: a client should always be able to open their manage link and
-- see what happened to their booking. Previously public_cancel_by_token expired
-- the token (`UPDATE booking_tokens SET expires_at = now()`), so revisiting the
-- link after cancelling hit a dead-end "Link no longer valid" page that
-- conflated expired / already-passed / cancelled.
--
-- The token now keeps its original expiry (30 days past the appointment end),
-- which remains the real cleanup boundary. The manage page branches on the
-- appointment's actual status/time instead of token validity alone.

CREATE OR REPLACE FUNCTION public.public_cancel_by_token(_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_appt uuid;
BEGIN
  SELECT bt.appointment_id INTO v_appt
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  WHERE bt.token = _token
    AND (bt.expires_at IS NULL OR bt.expires_at > now())
    AND a.status = 'scheduled'
    AND a.starts_at > now();
  IF v_appt IS NULL THEN RETURN false; END IF;
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  -- Deliberately NOT expiring the token here: the client keeps read access so
  -- the manage page can show the cancelled state.
  RETURN true;
END $$;
