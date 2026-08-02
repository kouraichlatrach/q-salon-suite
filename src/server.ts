import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
// Path constant only — the handler itself is imported lazily so the payments
// module (and its Node crypto usage) stays out of the normal SSR path.
import { PAYMENT_WEBHOOK_PATH } from "./lib/payments/webhook-path";
import { WHATSAPP_WEBHOOK_PATH } from "./lib/whatsapp/webhook-path";
import { JOBS_REMINDER_PATH } from "./lib/whatsapp/jobs-path";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Payment webhooks are handled before the SSR entry: signature
      // verification needs the raw request body, and this is the only layer
      // guaranteed not to have parsed it already.
      const url = new URL(request.url);
      if (url.pathname === PAYMENT_WEBHOOK_PATH) {
        const { handlePaymentWebhook } = await import("./lib/payments/webhook.server");
        return await handlePaymentWebhook(request);
      }

      // Inbound WhatsApp (STOP/START). Same reasoning as the payment webhook:
      // Twilio signs over the raw form body, so it must not be parsed upstream.
      if (url.pathname === WHATSAPP_WEBHOOK_PATH) {
        const { handleWhatsAppWebhook } = await import("./lib/whatsapp/webhook.server");
        return await handleWhatsAppWebhook(request);
      }

      // Scheduled reminder sweep, invoked by pg_cron via pg_net. Secret-guarded
      // because it triggers outbound messaging.
      if (url.pathname === JOBS_REMINDER_PATH) {
        const { handleReminderJobRequest } = await import(
          "./lib/whatsapp/reminder-job.server"
        );
        return await handleReminderJobRequest(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
