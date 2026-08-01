/**
 * Payment provider factory.
 *
 * The single place that decides which adapter is live. When Dibsy sandbox
 * access exists, adding it should be exactly:
 *
 *   import { DibsyPaymentProvider } from "./dibsy-provider.server";
 *   case "dibsy": return new DibsyPaymentProvider();
 *
 * ...plus setting PAYMENT_PROVIDER=dibsy. No caller changes.
 */

import type { PaymentProvider } from "./provider";
import { MockPaymentProvider } from "./mock-provider.server";

let cached: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const name = (process.env.PAYMENT_PROVIDER || "mock").toLowerCase();
  switch (name) {
    case "mock":
      cached = new MockPaymentProvider();
      break;
    default:
      // Fail loudly rather than silently falling back to the mock: quietly
      // using a fake gateway in an environment that expected a real one would
      // mean "paid" bookings that never took money.
      throw new Error(
        `Unknown PAYMENT_PROVIDER "${name}". Supported: mock. (Dibsy adapter not built yet.)`,
      );
  }
  return cached;
}

/** Test seam — lets a test swap in a stub without reaching into module state. */
export function __setPaymentProviderForTests(p: PaymentProvider | undefined) {
  cached = p;
}

export type * from "./provider";
