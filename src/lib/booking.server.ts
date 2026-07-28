/**
 * Server-only helpers for the public booking portal.
 *
 * Kept out of `booking.functions.ts` on purpose: modules that declare
 * `createServerFn` are split at build time, so sibling helpers must live in an
 * imported module or they become `ReferenceError`s at runtime.
 */
import { sendSms } from "./sms.server";

/** Loosely-typed admin client — the public_* RPCs are newer than the generated types. */
export async function adminRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as {
    rpc: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Normalises a Qatari / international phone number to E.164.
 * Bare 8-digit numbers are assumed to be Qatar (+974).
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    const bare = digits.replace(/\D/g, "");
    if (bare.length === 8) digits = `+974${bare}`;
    else if (bare.length > 8) digits = `+${bare}`;
    else return null;
  }
  const e164 = digits.replace(/(?!^\+)\D/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  return e164;
}

export function generateOtpCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

export async function deliverOtp(opts: {
  phone: string;
  code: string;
  brandName: string;
  smsSender?: string | null;
}) {
  return sendSms({
    to: opts.phone,
    from: opts.smsSender,
    body: `${opts.code} is your ${opts.brandName} booking verification code. It expires in 10 minutes.`,
  });
}

export async function deliverManageLink(opts: {
  phone: string;
  brandName: string;
  when: string;
  manageUrl: string;
  smsSender?: string | null;
}) {
  try {
    return await sendSms({
      to: opts.phone,
      from: opts.smsSender,
      body: `Your ${opts.brandName} booking is confirmed for ${opts.when}. Manage or cancel: ${opts.manageUrl}`,
    });
  } catch (err) {
    // A failed confirmation SMS must never roll back a successful booking.
    console.error("[booking] confirmation SMS failed", err);
    return { delivered: false as const, provider: "dev" as const, reason: "send_failed" };
  }
}

export function buildManageUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/manage/${token}`;
}
