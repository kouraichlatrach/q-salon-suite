/**
 * Shared money formatting for every client-facing surface.
 *
 * Previously each page formatted with `maximumFractionDigits: 0`, which rounded
 * a stored price of 90.24 down to "90 QAR". Once deposits existed that became a
 * correctness problem rather than a cosmetic one: a client shown "90 QAR" and
 * "30% deposit" computes 27.00, but the charge is 30% of the true 90.24 = 27.07.
 * A client should never be able to do the arithmetic themselves and get a
 * different number from what they are charged.
 *
 * So: show up to 2 decimals, but don't pad whole amounts. 90.24 renders as
 * "90.24 QAR"; a clean 90 still renders as "90 QAR", not "90.00 QAR".
 *
 * Deposit amounts are deliberately NOT computed here — they come from
 * `public_resolve_deposit` via the server. Re-implementing that rule in the
 * client would be a second source of truth for money, which is how the two
 * numbers drift apart in the first place.
 */
export function formatMoney(value: number | string | null | undefined, currency = "QAR"): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  // All-or-nothing on decimals: 90 → "90", 331.8 → "331.80". A lone decimal
  // ("331.8 QAR") reads like a truncated number rather than a price.
  const hasFraction = !Number.isInteger(safe);
  return `${new Intl.NumberFormat("en-QA", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(safe)} ${currency}`;
}
