/**
 * Inbound webhook mount path, in its own module so `src/server.ts` can route to
 * it without importing the handler (which pulls in node:crypto and the Supabase
 * admin client). Same split as the payments webhook.
 */
export const WHATSAPP_WEBHOOK_PATH = "/api/whatsapp/inbound";
