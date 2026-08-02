-- Scheduled jobs — the mechanism Section 10 assumed already existed.
--
-- It didn't. Phase A shipped `expire_stale_deposit_holds()` but nothing ever
-- invoked it, so abandoned deposit holds have never actually been cleaned up.
-- This migration installs pg_cron and wires BOTH jobs to it: the Phase A
-- cleanup (pure SQL, runs entirely in-database) and the WhatsApp reminder sweep
-- (needs an HTTP call out to the app, because sending requires the provider).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- Job configuration.
--
-- The reminder sweep has to reach the app over HTTP, so the database needs to
-- know its public URL and the shared secret. Kept in a table rather than
-- hardcoded because it differs per environment, and because localhost is not
-- reachable from Supabase — in local dev the sweep is invoked manually instead.
--
-- service_role only: this row holds a secret that authorises outbound messaging.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_job_config (
  key         text PRIMARY KEY,
  value       text,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_job_config ENABLE ROW LEVEL SECURITY;
-- No policies at all: unreachable via PostgREST for any signed-in role.
-- SECURITY DEFINER functions and service_role still read it.

INSERT INTO public.app_job_config(key, value, description) VALUES
  ('jobs_base_url', NULL, 'Public base URL of the app, e.g. https://app.example.com. NULL disables HTTP-dispatched jobs (local dev — localhost is unreachable from Supabase).'),
  ('jobs_secret',   NULL, 'Must match JOBS_SECRET in the app environment.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Reminder dispatch: pg_net fire-and-forget POST to the app.
--
-- Deliberately no-ops when unconfigured rather than erroring, so an unset local
-- environment doesn't fill cron.job_run_details with noise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_whatsapp_reminder_sweep()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_url text; v_secret text; v_request_id bigint;
BEGIN
  SELECT value INTO v_url    FROM public.app_job_config WHERE key = 'jobs_base_url';
  SELECT value INTO v_secret FROM public.app_job_config WHERE key = 'jobs_secret';

  IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
    RETURN 'skipped: jobs_base_url/jobs_secret not configured';
  END IF;

  SELECT net.http_post(
    url     := rtrim(v_url,'/') || '/api/jobs/whatsapp-reminders',
    headers := jsonb_build_object('content-type','application/json','x-jobs-secret',v_secret),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN 'dispatched request ' || v_request_id;
END $function$;

REVOKE ALL ON FUNCTION public.dispatch_whatsapp_reminder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_whatsapp_reminder_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- Schedules. Unschedule first so re-running this migration is idempotent.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('whatsapp-reminder-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-deposit-holds');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Every 15 minutes (Section 10 suggests 15–30). Reminder precision is bounded
-- by this interval, which is well within tolerance for a 24h lead time.
SELECT cron.schedule(
  'whatsapp-reminder-sweep',
  '*/15 * * * *',
  $$SELECT public.dispatch_whatsapp_reminder_sweep();$$
);

-- Phase A cleanup, finally actually scheduled. Hourly is ample: availability is
-- already correct on read via appointment_holds_slot(), so this job only tidies
-- abandoned rows out of the calendar and reports.
SELECT cron.schedule(
  'expire-stale-deposit-holds',
  '7 * * * *',
  $$SELECT public.expire_stale_deposit_holds(60);$$
);
