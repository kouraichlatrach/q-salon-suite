---
name: token-efficient
description: "Default working mode for this project. Minimizes token usage on routine tasks (UI copy, refactors, non-money-touching cleanup). Does NOT apply to anything touching Payments, RLS policies, auth, or money-adjacent logic — those follow full-rigor mode instead. Use when starting any coding task in this repo."
---

# Token Efficiency Rules (default mode)

## 1. Read Only What Is Needed

* Never scan the entire project.
* Read only files directly related to the task.
* Follow imports/dependencies only when necessary.
* Do not summarize unrelated files.

## 2. No Repeated Analysis

* If a file has already been analyzed in this session, do not analyze it again unless it changed.
* Assume previous context is still valid.

## 3. Minimal Output

Return only: files changed, reasoning (max 3 bullets), code. Do not explain obvious code.

## 4. Edit Instead of Rewrite

Modify the smallest possible section. Avoid rewriting whole files, reformatting, moving code unnecessarily.

## 5. Preserve Existing Architecture

Do not rename folders/functions, change coding style, or introduce new libraries unless explicitly requested.

## 6. No Speculation

If information is missing, ask one question. Do not guess.

## 7. Search Strategy

Search in order: exact filename → symbol/function → text search. Stop immediately after locating the target.

## 8. Response Size

Keep responses under 250 words unless requested otherwise.

## 9. Planning

Never create long plans. Only plan if requested or more than 5 files will change. Otherwise start editing immediately.

## 10. Large Files

Never read a large file completely. Read imports, relevant function, nearby context only. Expand only if needed.

## 11. Code Generation

Generate only requested code. Do not generate tests, documentation, examples, or comments unless requested.

## 12. Git Awareness

Before editing: identify modified files, avoid conflicts, edit only necessary lines.

## 13. Framework Awareness

Respect existing architecture, naming, folder structure, dependency versions.

## 14. Performance

Prefer existing utilities/components/hooks. Avoid duplicates.

## 15. Token Budget

Assume every token costs money. Always choose the smallest valid response.

## ⚠️ EXCEPTION — Full-Rigor Mode Overrides All Rules Above

Check this section before applying any rule above. Full-rigor mode applies to any task touching:

* Payments — anything under `payment_*`, `deposit_*`, `gift_card_*`, `income_records`, webhooks, refunds, or the `PaymentProvider` adapter.
* RLS policies — any `CREATE POLICY` / `ALTER POLICY`, or any change to a table with RLS enabled.
* Auth — sign-up/sign-in flows, session handling, `auth.users`, role/permission checks.
* Money-adjacent logic generally — anything that debits/credits a balance, computes a charge, or writes to an audit-log table.
* Migrations — schema changes always get read in full, not skimmed, regardless of size.

If any of the above applies, suspend rules 1–15 entirely for that task and instead:

* Re-analyze even if a file was already read this session — don't assume prior context is still valid for money/security logic specifically.
* Trace write-order and RLS conditions explicitly, not just "does it typecheck."
* A real browser/functional walkthrough is required before calling anything done — database-level or type-level verification alone is not sufficient. (Direct lesson from this project's Phase A: a mandatory deposit was silently skippable, passed every automated check, and was only caught by an actual click-through.)
* Long-form output is expected and fine here — brevity is not the goal on this category of work.
* If genuinely unsure whether a task falls into this exception, treat it as if it does.

One-line rule of thumb: if a bug here could lose money, leak data, or let the wrong person in, token-efficient mode does not apply
