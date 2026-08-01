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

import { PAYMENT_WEBHOOK_PATH } from "./webhook-path";

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
    // Hard refusal outside mock mode: this endpoint can mint "payment
    // succeeded" events, so it must never be callable against a real gateway.
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
