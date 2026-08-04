/**
 * Server function backing the developer mock-checkout page.
 *
 * Signs a payload with the mock shared secret and POSTs it to the REAL webhook
 * endpoint over real HTTP. The signing secret never reaches the browser, and
 * the production verification path runs unmodified — the mock is a stand-in for
 * the gateway, not a bypass of our own code.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { devToolsEnabled } from "../env.server";
import { PAYMENT_WEBHOOK_PATH } from "./webhook-path";

/**
 * Lets the page render an honest "unavailable" state instead of showing
 * working-looking buttons that would 404 on click. The handler above is the
 * authority — this is presentation only, and is evaluated server-side so it
 * reflects the same runtime NODE_ENV rather than a build-time constant.
 */
export const devToolsStatus = createServerFn({ method: "GET" }).handler(
  async () => ({ enabled: devToolsEnabled() }),
);

export const simulateMockPayment = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      ref: string;
      outcome: "succeeded" | "failed";
      amount: number;
      currency: string;
      metadata?: Record<string, string>;
      /** Deliberately corrupt the signature, to prove verification rejects it. */
      tamper?: boolean;
    }) =>
      z
        .object({
          ref: z.string().min(3).max(200),
          outcome: z.enum(["succeeded", "failed"]),
          amount: z.number().positive(),
          currency: z.string().min(1).max(8),
          metadata: z.record(z.string(), z.string()).optional(),
          tamper: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    // Hard refusal on any deployed build. This endpoint mints "payment
    // succeeded" events, so reachability is the whole risk — and the
    // PAYMENT_PROVIDER check below cannot carry that on its own, because it
    // defaults to "mock" when unset. A deployment with no payment
    // configuration at all therefore passed it.
    if (!devToolsEnabled()) {
      return {
        ok: false as const,
        status: 404,
        body: "not found",
      };
    }

    // Kept as a second, independent condition: even in development this must
    // never be callable once a real gateway is configured.
    if ((process.env.PAYMENT_PROVIDER || "mock").toLowerCase() !== "mock") {
      return { ok: false as const, status: 403, body: "mock checkout disabled (PAYMENT_PROVIDER is not 'mock')" };
    }

    const { signMockPayload } = await import("./mock-provider.server");

    const payload = JSON.stringify({
      ref: data.ref,
      type: data.outcome === "succeeded" ? "charge.succeeded" : "charge.failed",
      amount: data.amount,
      currency: data.currency,
      metadata: data.metadata ?? {},
    });

    const ts = Math.floor(Date.now() / 1000);
    let signature = signMockPayload(payload, ts);
    if (data.tamper) {
      // Flip the last hex digit — same shape, wrong MAC.
      signature = signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    }

    const origin = new URL(getRequest().url).origin;
    const res = await fetch(`${origin}${PAYMENT_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mock-signature": signature,
      },
      body: payload,
    });

    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  });
