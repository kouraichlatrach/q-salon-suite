/**
 * Webhook mount path, in its own module so `src/server.ts` and the dev mock
 * checkout page can both reference it without pulling in the handler (which
 * imports node:crypto and the Supabase admin client).
 */
export const PAYMENT_WEBHOOK_PATH = "/api/payments/webhook";
