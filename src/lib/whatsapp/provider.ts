/**
 * WhatsApp provider abstraction (Section 10).
 *
 * Same shape as the payments `PaymentProvider` and the existing `sendSms()`
 * adapter: callers never touch a provider SDK, so swapping Twilio for another
 * BSP later is a contained change.
 *
 * Types only — no secrets, no Node APIs — so this file is safe to import from
 * anywhere. Implementations live in `*.server.ts` siblings.
 */

export type WhatsAppMessageKind = "booking_confirmation" | "appointment_reminder";

export type SendWhatsAppInput = {
  /** E.164, without the `whatsapp:` prefix — the adapter adds it. */
  to: string;
  kind: WhatsAppMessageKind;
  /**
   * Meta-approved template (Twilio Content SID, `HX…`). Required for
   * business-initiated messages outside an open 24-hour session window.
   */
  contentSid?: string | null;
  /** Ordered template variables, keyed "1", "2", … as Twilio expects. */
  variables?: Record<string, string>;
  /**
   * Plain-text fallback used only when no template is configured. Delivers
   * *only* inside an open session window, which in practice means sandbox
   * testing after the recipient has messaged in. Never rely on this in prod.
   */
  body?: string;
};

export type SendWhatsAppResult =
  | { delivered: true; provider: string; sid: string }
  /** Soft failure — callers should log and continue, never break a booking. */
  | { delivered: false; provider: string; reason: string; retryable: boolean };

/** Normalised inbound message, after signature verification. */
export type InboundWhatsAppMessage = {
  /** E.164, `whatsapp:` prefix stripped. */
  from: string;
  body: string;
  messageSid: string;
  raw: Record<string, string>;
};

export type InboundVerification =
  | { valid: true; message: InboundWhatsAppMessage }
  | { valid: false; reason: string };

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: SendWhatsAppInput): Promise<SendWhatsAppResult>;
  /**
   * Verifies an inbound webhook (used for STOP handling). Takes the exact
   * request URL and raw form body — Twilio signs over both.
   */
  verifyInbound(
    url: string,
    rawBody: string,
    headers: Record<string, string>,
  ): InboundVerification;
}

/**
 * Keywords that must stop messaging. Twilio auto-handles the standard set at
 * the platform level for WhatsApp senders, but we mirror it in our own data so
 * the app's `whatsapp_opt_in` flag reflects reality — otherwise the UI would
 * keep showing a client as opted in while the platform silently blocks them.
 */
export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "cancel", "end", "quit", "stopall"];

export function isOptOutKeyword(body: string): boolean {
  return OPT_OUT_KEYWORDS.includes(body.trim().toLowerCase());
}

/** Keywords that re-enable messaging after an opt-out. */
export const OPT_IN_KEYWORDS = ["start", "unstop", "yes"];

export function isOptInKeyword(body: string): boolean {
  return OPT_IN_KEYWORDS.includes(body.trim().toLowerCase());
}
