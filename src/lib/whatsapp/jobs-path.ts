/** Scheduled-job endpoint path, split out so server.ts can route without
 *  importing the job runner (which pulls in the Supabase admin client). */
export const JOBS_REMINDER_PATH = "/api/jobs/whatsapp-reminders";
