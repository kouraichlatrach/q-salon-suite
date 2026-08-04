# Token-Efficient Mode — Scope & Exceptions

This project uses three working modes. Check which one applies **before** starting any task — don't default to token-efficient mode just because it's active.

Precedence, highest first:

1. **Full rigor** (money / security / migrations) — overrides everything below.
2. **Hallmark** (UI and visual design work) — overrides token-efficient.
3. **Token-efficient** — the default for everything else.

## Default: token-efficient mode
Applies to UI copy, minor refactors, non-money-touching cleanup, low-stakes bug fixes, anything reversible with no data/security implications. Follow the `token-efficient` skill rules as written: minimal reads, minimal output, no speculative tests/docs, edit don't rewrite, stop searching once the target is found.

Note "styling" moved out of this list — see the Hallmark exception below. Token-efficient still governs **non-visual** refactors: renaming, extracting helpers, dependency bumps, type cleanups, and behaviour-preserving restructuring that doesn't change what the user sees.

## Exception: Hallmark mode (visual design work)
Switch to the `hallmark` skill's full workflow — pre-flight scan, design-context gate, macrostructure and theme picks stated out loud, preview block before any code, then the 58-gate slop test — for **any** task that is about how the product *looks*:

- New pages or screens.
- Redesigns of existing pages or screens.
- Component styling and visual treatment (buttons, cards, tables, empty states, badges).
- Design tokens, palette, typography, spacing scale, motion.

Hallmark's ceremony is the point here, and it is deliberately the opposite of token-efficient's minimal-output default: on visual work the expensive part is shipping something that looks generated, not the tokens spent avoiding it. Do not shortcut the preview block or the slop test to save output — that is precisely the tradeoff this exception exists to refuse.

**Why this doesn't collide with full rigor:** Hallmark's own scope statement (`references/contract.md`) excludes logic, state management, data fetching, and business rules — it is a visual and interaction layer only. So a Hallmark task cannot, by its own rules, be the thing that touches Payments, RLS, or auth. If a task somehow spans both — restyling a screen *and* changing a settlement rule — split it: the money change follows full rigor, the visual change follows Hallmark.

**Still applies under Hallmark:** the real browser walkthrough from Section 7. Hallmark's slop test checks the design; it does not prove the page renders with real data for a real role. Both are required.

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
If a bug in this code could **lose money, leak data, or let the wrong person in**, neither token-efficient nor Hallmark applies — use the same rigor that's caught every real bug in this project so far.

If the task is about **how it looks**, use Hallmark and run its whole workflow. Everything else is token-efficient.
