# Token-Efficient Mode — Scope & Exceptions

This project uses two working modes. Check which one applies **before** starting any task — don't default to token-efficient mode just because it's active.

## Default: token-efficient mode
Applies to UI copy, minor refactors, styling, non-money-touching cleanup, low-stakes bug fixes, anything reversible with no data/security implications. Follow the `token-efficient` skill rules as written: minimal reads, minimal output, no speculative tests/docs, edit don't rewrite, stop searching once the target is found.

## Exception: full rigor mode (Section 7 of Q-Salon-Suite-Project-Spec.md overrides token-efficient)
Switch to full rigor — deep tracing, repeated verification, real browser walkthroughs, no shortcuts on analysis depth — for **any** task touching:

- **Payments** — anything under `payment_*`, `deposit_*`, `gift_card_*`, `income_records`, webhooks, refunds, or the `PaymentProvider` adapter.
- **RLS policies** — any `CREATE POLICY` / `ALTER POLICY`, or any change to a table with RLS enabled.
- **Auth** — sign-up/sign-in flows, session handling, `auth.users`, role/permission checks.
- **Money-adjacent logic generally** — anything that debits/credits a balance, computes a charge, or writes to an audit-log table.
- **Migrations** — schema changes always get read in full, not skimmed, regardless of size.

In these cases:
- Re-analyze even if a file was already read this session, if the task touches money/security logic — don't assume prior context is still valid for these specifically.
- Trace write-order and RLS conditions explicitly, not just "does it typecheck."
- A real browser/functional walkthrough is required before calling anything done — database-level or type-level verification alone is **not** sufficient (this is the direct lesson from Phase A: a mandatory deposit was silently skippable, passed every automated check, and only a real click-through caught it).
- Long-form output (full reasoning, not 3 bullets) is expected and fine here — brevity is not the goal on this category of work.
- If genuinely unsure whether a task falls into this exception, treat it as if it does. Ask, don't guess, per the base skill's own Rule #6 — but the default assumption for anything touching data or money should be "verify thoroughly," not "assume it's fine."

## One-line rule of thumb
If a bug in this code could **lose money, leak data, or let the wrong person in**, token-efficient mode does not apply — use the same rigor that's caught every real bug in this project so far.
