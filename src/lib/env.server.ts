/**
 * Environment predicates, in one place.
 *
 * Two separate guards depend on "is this production?" — the app base URL
 * resolution and the developer mock-checkout page. Defining that twice is how
 * they eventually disagree, so both read it from here.
 *
 * **This is decided at build time, not runtime.** Vite statically replaces
 * `process.env.NODE_ENV` while bundling, so in a production build the compiled
 * output of the function below is literally `return true`. Verified by reading
 * the emitted server bundle, not assumed.
 *
 * That is the stronger guarantee, and is why it is left as-is: a deployed build
 * cannot be talked back into development mode by setting an environment
 * variable on the host. The flip side is the part worth knowing — the developer
 * mock checkout below cannot be enabled on *any* deployed build, including a
 * Vercel preview, by any configuration. Exercising it requires a development
 * build, which is where it belongs.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Developer-only surfaces (the mock checkout page and the server function
 * behind it) must never be reachable on a deployed build.
 *
 * Note this is deliberately NOT keyed on PAYMENT_PROVIDER. That check answers
 * "is a real gateway configured", which is a different question and defaults to
 * "mock" when unset — so on a deployment with no payment configuration at all,
 * it let the dev tooling through. Both checks are kept, as independent
 * conditions rather than one replacing the other.
 */
export function devToolsEnabled(): boolean {
  return !isProduction();
}
