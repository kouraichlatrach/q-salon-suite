/**
 * WhatsApp provider factory — the single place that decides which adapter is
 * live, mirroring `getPaymentProvider()`.
 *
 * Adding another BSP later should be one new file plus one `case` here.
 */

import type { WhatsAppProvider } from "./provider";
import { TwilioWhatsAppProvider } from "./twilio-provider.server";

let cached: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;

  const name = (process.env.WHATSAPP_PROVIDER || "twilio").toLowerCase();
  switch (name) {
    case "twilio":
      cached = new TwilioWhatsAppProvider();
      break;
    default:
      // Fail loudly rather than silently not messaging anyone: a typo here
      // would look identical to "nobody opted in".
      throw new Error(`Unknown WHATSAPP_PROVIDER "${name}". Supported: twilio.`);
  }
  return cached;
}

/** Test seam, matching the payments module. */
export function __setWhatsAppProviderForTests(p: WhatsAppProvider | undefined) {
  cached = p;
}

export type * from "./provider";
