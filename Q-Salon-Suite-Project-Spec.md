# Q-Salon Suite — Project Spec & Handoff Document

*Living document. Update after every major Claude Code session so "what's shipped" stays accurate.*

---

## 1. Product Summary

Multi-tenant SaaS for beauty salon chains in Qatar. Owners subscribe (monthly/yearly, manual billing in v1) and manage multiple locations under one Brand. Role-scoped staff accounts (Owner, Manager, Receptionist, Staff/Technician) handle appointments, clients, stock, and services with Postgres RLS enforcing all access boundaries.

**Stack:** React + TanStack Router/Start (file-based, nested routes, SSR + server functions) + Supabase (Postgres, Auth, RLS). Originally built in Lovable; now developed in Claude Code against a GitHub repo. Region: Mumbai (ap-south-1).

---

## 2. Core Decisions (from original planning interview — still governing)

1. Hierarchy: Owner → Salon Brand → Locations (many). One subscription per Brand.
2. Plans (restructured 2026-08-05 — supersedes the original Starter/Growth/Enterprise limits): **Starter** 1 location / 10 staff, 549 QAR/mo or 5,600/yr · **Growth** 1 location / 20 staff, 849 QAR/mo or 8,660/yr · **Professional** (new tier) 3 locations / 50 staff, 1,999 QAR/mo or 20,390/yr · **Enterprise** unlimited (999/999 sentinel), no published price. Staff counts exclude the Owner. Enforced at the DB level via triggers. Figures live in `src/lib/plan-limits.ts` and are mirrored onto `brands` — never retyped into a page.
   - **Extra-location add-on:** +299 QAR/mo per location, available on Starter/Growth/Professional (not Enterprise, which is already unlimited). Stored as `brands.addon_locations`; the location ceiling is now `max_locations + addon_locations`, not `max_locations`. No self-serve purchase flow — a Platform Admin sets the count by hand after the Owner asks.
   - **Staff limits remain a hard per-tier ceiling** — no staff add-on is specced.
   - ⚠ **Limits are mirrored onto each brand, not looked up.** Changing what a tier means does **not** reach brands already on it — they keep the numbers written at creation or last `/admin` save. Every brand created before 2026-08-05 is therefore mis-limited against the new tiers. Safe only because there are no paying customers; **see Section 12 before the first real signup.**
3. Roles: Owner, Location Manager, Receptionist, Staff/Technician — fixed, not a custom permission builder.
4. Clients: shared brand-wide (not siloed per location); appointments/transactions still tagged per-location.
5. Stock: shared product catalog brand-wide; quantity tracked per-location.
6. Services/pricing: shared catalog; Owner-only per-location price overrides. Pricing is shown client-facing on the Self-Booking flow — no longer purely internal.
7. Income: manual logging by default; extended with real payment processing (see Section 9).
8. Subscription billing: manual/offline today; automation planned (Section 9, Phase C).
9. Platform Admin: separate internal tool, outside customer-facing RLS, gated by a `platform_admins` allowlist table.
10. Language: English-only UI chrome; Arabic-capable data fields (`dir="auto"`).
11. Notifications: manual `wa.me` link only today; **full WhatsApp automation now specced — see Section 10.**
12. Scheduling: basic conflict prevention (staff working hours + leave), hard DB block on double-booking.
13. Client profile: text-only (no photos) + structured per-visit service record.
14. Reports: revenue, stock, staff performance — no profitability/margin math yet.
15. No-shows: tracked and visible as a count/badge on the client profile.
16. Staff account creation: Owner creates Managers; Managers create Receptionist/Staff scoped to their own location only.
17. Staff calendar visibility: Staff/Technician sees only their own appointments, not the full location calendar.
18. Currency: `currency` column on all money tables, defaulted to `'QAR'`.
19. Data residency: Supabase project in Mumbai region.

---

## 3. Modules Shipped / In Progress

| # | Module | Status |
|---|---|---|
| 1 | Clients (`/app/clients`, `/app/clients/:id`) | ✅ Shipped. Detail page (`:id`) was silently broken by an Outlet regression for an unknown period — found and fixed, see Section 6. |
| 2 | Staff invites (`/app/staff`) | ✅ Shipped, DB-level plan-limit enforcement |
| 3 | Appointments (`/app/appointments`) | ✅ Shipped, hard DB overlap prevention, product-usage auto-deducts stock |
| 4 | Services & pricing (`/app/services`) | ✅ Shipped, Owner-only per-location overrides |
| 5 | Stock (`/app/stock`) | ✅ Shipped, single-source-of-truth quantity trigger, auto-deduction on completion |
| 6 | Reports (`/app/reports`) | ✅ Shipped, consistent location scoping |
| 7 | Platform Admin (`/admin`) | ✅ Shipped, gated by `platform_admins` |
| 8 | Locations & Settings (`/app/locations`, `/app/settings`) | ✅ Shipped, DB-enforced location plan limit |
| 9 | Self-Booking Portal (`/book/:brandSlug`, `/manage/:token`) | ✅ Shipped and edge-case tested. |
| 10 | **Payments — Phase A (Booking Deposits)** | ✅ **Built and verified against a mock payment provider**, including two full manual browser walkthroughs that caught and fixed critical bugs automated/DB-level testing missed entirely. **Not yet swapped to real Dibsy** — no sandbox account exists yet (business not yet registered). See Section 9. |
| 11 | Payments — Phase B (In-Salon Checkout) | 📋 Specced, not built. Do not start until Phase A is running against real Dibsy, not the mock provider. |
| 12 | Payments — Phase C (Subscription Billing) | 📋 Specced, not built. |
| 13 | **WhatsApp Automation** | 🟡 **Built except the send itself.** Consent capture, opt-out, scheduling, and audit logging are all done and working. The actual outbound message is blocked by the Twilio **trial account** (error 21654 — see Section 10). |
| 14 | **Packages (client-facing)** | ✅ **Shipped.** Multi-service bundles with an independent remaining count per service, detection at both booking and checkout, session debited only at checkout, expiry-as-live-check, refund-while-unused with a goodwill expiry extension after, and an expired-with-sessions-left Owner report. Revenue recognised once, at sale. Verified by browser walkthrough. See Section 11. |
| 15 | **Gift Cards** | ✅ **Shipped.** Sale, code lookup, partial redemption across multiple visits, expiry-as-live-check, and an expired-with-balance Owner report. Revenue recognised once, at sale. Verified by browser walkthrough. See Section 11. |
| 17 | **Staff profiles** (`/app/staff/:id`) | ✅ **Shipped.** Personal details (PII, tiered RLS), photos via the project's first Storage bucket, location history with an atomic transfer RPC, per-location performance, leave and schedule on one page. See Section 13. |
| 16 | **Memberships** | 📋 **Fully specced, not built.** Depends on Payments Phase C's recurring-billing mechanics (retry schedule, no-proration model) — do not start until Phase C is built and proven, since Memberships is specced to directly reuse that machinery rather than re-solve it. See Section 11. |

---

## 4. Known Working Patterns & Bug Classes to Watch For

These are lessons earned the hard way — worth checking for explicitly in every future module, not just fixed once and forgotten.

1. **Missing `<Outlet />` on nested/parent routes.** Found and fixed three times now: `app.tsx` (blocked all of `/app/*`), then `app.clients.tsx`/`app.staff.tsx`/`book.$brandSlug.tsx` (blocked detail pages and the lookup route), and the pattern held correctly for the newer `book.$brandSlug.confirmed.tsx` child route added during Phase A UX fixes — confirmed *because* it was checked explicitly, not assumed. **Any new parent route with child routes must be checked for this explicitly**, and re-verified after any commit/merge/branch switch, since a correct fix can exist on one branch while the running dev server serves an older, unfixed branch.
2. **`pgcrypto` functions live in the `extensions` schema, not `public`.** A `SECURITY DEFINER` function with `SET search_path TO 'public'` will fail on unqualified `crypt()`/`gen_salt()`/`gen_random_bytes()` calls. Always fully qualify (`extensions.crypt(...)`) — do not widen the search_path as the fix, since that's a security regression for SECURITY DEFINER functions.
3. **Client/data rollback scope in multi-step RPCs.** Any RPC doing multiple related inserts (or inserts + external side effects, like a payment record) needs every step that should be atomic together inside the same exception scope. First hit with orphan client rows on failed self-bookings; the same class of risk applies to any Payments RPC touching both appointment/deposit state and a payment record.
4. **Generic error messages hide real causes.** Fixed multiple times independently: the `err instanceof Error` pattern (Supabase/PostgREST errors are plain objects), and a static `errorComponent` that always showed the same text regardless of the actual thrown error. Always surface the real error, at least in non-production contexts.
5. **`supabase db push` / migration drift.** Root cause was historical: Lovable-applied migrations recorded `version` at apply-time (a few seconds after the filename's declared timestamp), making every migration look "foreign" to the CLI. Fixed via careful realignment; verified idempotent with a no-op test migration. All new migrations should go through the Supabase CLI to avoid reintroducing this drift.
6. **`.env` hygiene.** `.env` was tracked in git and briefly exposed a real Supabase service-role key. Resolved: rotated, legacy JWT-based keys disabled entirely, `.env` gitignored with a `.env.example` template. **Known hazard:** a `git reset --hard` to a commit before `.env` was untracked will delete the local file — keep a backup of real key values somewhere outside git.
7. **Enum values assigned through a `CASE` expression get typed as `text`, not the enum, and Postgres won't implicitly cast it.** Found in Phase A: a refund-recording RPC used `CASE WHEN ... THEN 'succeeded' ELSE 'failed' END` to set a `payment_state` enum column — this only fails at the exact moment the branch that hits the enum column executes, meaning it can pass code review and pass "happy path" testing cleanly, then fail in production on the first real edge case. In this instance, that edge case was a refund: the provider had already returned money before the write failed, so the appointment stayed marked "paid" with no refund on record — a silent money-loss bug, caught only because the database was checked directly after the UI reported success. **Any conditional enum assignment needs an explicit `::enum_type` cast on every branch, not just at the final assignment.**
8. **`IMMUTABLE` on a function that reads `now()` (or anything else non-constant) is a correctness trap, not just a style issue.** Postgres does not validate that an `IMMUTABLE` label is actually true — it trusts the declaration and may let the query planner constant-fold the function's result, meaning a value that should change over time (like an expiry check) can silently "stick" at a stale result. This is most dangerous when the same predicate is shared between a database trigger (enforcing a rule) and a read path (computing availability) — a subtly wrong label can make both agree on an incorrect answer rather than one surfacing an obvious error. Found in Phase A on the appointment-hold expiry check; corrected to `STABLE`. **Any function reading `now()`, a sequence, or other session/transaction-varying state must never be declared `IMMUTABLE`.**
9. **A money-writing operation with no terminal-state guard will happily run twice.** Found while building Packages, but the bug predated it: `appointment_settle` had no check for an appointment that was already `completed`, so settling one a second time re-ran the whole flow — a duplicate `income_records` row and a second debit against any gift card supplied. Packages would have made it burn a second prepaid session on top. Nothing exotic was needed to trigger it: the appointment menu offers "Mark completed" unconditionally regardless of current status, so a double-click, an impatient retry, or a stale tab left open by another staff member was enough. **The guard belongs in the database function that owns the money rules, not in one caller's disabled-button state** — a UI that hides the action still leaves the RPC reachable, and this project has multiple entry points to the same settlement. This is distinct from the idempotency keys already used on the Payments provider path (Section 9): those protect against a *provider* replaying a webhook, and gave no protection at all against our own UI re-submitting. **Any RPC that moves money or debits a balance needs an explicit check that it hasn't already run for that record, returning a clear already-done error rather than silently repeating the work.**

10. **RLS filters rows, never columns — a table-wide `GRANT UPDATE` hands the user every column on any row they can reach.** Found on `brands` during the 2026-08-05 plan restructure, and it predated that work by months. `GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated` plus the `"Owner updates own brand"` policy meant an Owner could `UPDATE brands SET max_locations = 999, plan = 'enterprise'` from the browser with their ordinary session — and both plan-limit triggers read those very columns to decide what the Owner is allowed. Every plan limit in the product was therefore advisory rather than enforced, and the new paid location add-on would have been free to self-grant. **The trigger enforcing a limit must never read a number the constrained party can write.** Fixed with `guard_brand_billing_columns`, a BEFORE UPDATE trigger that rejects changes to plan/limits/add-ons/billing dates unless the caller is a Platform Admin or a server-side role. When a policy grants UPDATE, always ask which *columns* it just granted — the answer is "all of them" unless column-level privileges were set explicitly.

11. **Read-then-write against a limit is a race, and on a paid limit it is a revenue bug.** `enforce_location_plan_limit` counted rows and then inserted, so two concurrent inserts could both see room and both commit — a one-location brand ending up with two. Now serialised with `pg_advisory_xact_lock` keyed on the brand. `enforce_staff_plan_limit` still carries the same race and has not been fixed.

12. **`current_user` inside a `SECURITY DEFINER` function is the function's OWNER, not the caller — and a security check built on it silently exempts everybody.** The first `guard_brand_billing_columns` allowed `current_user IN ('postgres','service_role','supabase_admin')` as its "this is a trusted server-side caller" test. Because the function is `SECURITY DEFINER` and Supabase applies migrations as `postgres`, `current_user` evaluated to `'postgres'` on every invocation, so that clause was unconditionally true and the guard never blocked a single write. It passed code review, `db push` reported success, the trigger really was attached, and the schema looked entirely correct — a signed-in Owner could still set their own `max_locations` to 999. **`session_user` is no better here:** PostgREST connects as `authenticator` and then `SET`s the role, so it reads `authenticator` for `authenticated` and `service_role` alike and cannot separate them either. Identify the caller from something `SECURITY DEFINER` cannot rewrite — `auth.uid()` and the JWT's own `request.jwt.claims ->> 'role'` — or match on identity via `is_platform_admin()`. **A guard that exempts the wrong party fails open and looks exactly like a guard that works**, which is why this one needs a test that impersonates the real role rather than a review that reads the SQL: `supabase/tests/billing_guard_regression.sql` does the `SET LOCAL request.jwt.claims` + `SET LOCAL ROLE authenticated` dance and fails against the buggy version. Any future permission check in a trigger or RPC gets the same treatment.

13. **An RLS *read* gap does not look like a bug — it looks like an empty list, and the UI quietly compensates in the wrong direction.** Found on 2026-08-06 while restricting bookable staff to `role = 'staff'`. `user_roles` had SELECT policies for the user's own rows, for Owners brand-wide, and for Managers at their location — and **nothing for Receptionists**; `profiles` was the same, visible to owner/manager only. So a signed-in Receptionist querying `user_roles` got back exactly one row: their own. The appointments picker filtered that with `role = 'owner' OR location_id = <loc>`, their own receptionist row matched, and the dropdown rendered a single option — themselves. Nothing errored. Nobody saw an empty state. The Receptionist simply booked every appointment against a Receptionist account, which is a substantial share of the 125 non-Staff assignments the cleanup found. **The tell was absent precisely because the UI had a fallback that happened to match the caller's own row.** Two lessons: a read policy set that omits a role is invisible until you enumerate the roles explicitly, and tightening a UI filter over a too-narrow RLS view converts "silently wrong" into "silently empty" — the second failure was one line away and would also have shipped. Fixed by two narrow SELECT policies granting booking-capable roles sight of *staff-role rows only*, at locations they already administer. Covered by `supabase/tests/bookable_staff_regression.sql`, which impersonates a real Receptionist session rather than reading the policy SQL.

---

## 5. Self-Booking Portal — Shipped & Verified

**Public entry:** `/book/:brandSlug` (brand-level link, location selection as step one, auto-skipped for single-location brands, deep-linkable via `?location=`).

**Verified working end-to-end, including edge cases:**
- Real data loads correctly (locations, services with effective per-location pricing, staff).
- Staff selection: both a specific named staff member and "No preference" (auto-assignment) — confirmed the auto-assign logic genuinely distributes between real qualified candidates via `staff_services`, not just defaulting to one.
- Availability computed live against `staff_schedules` + `staff_leave` + existing `appointments`, respecting Owner-configurable min-notice/max-advance settings.
- Phone OTP verification (dev-mode fallback shows the code on-screen when SMS/Twilio isn't connected — real provider integration still pending, see Section 10).
- Booking creates a real `appointments` row, `status = 'scheduled'`.
- **Race-condition handling:** verified by deliberately winning a slot with a competing request mid-flow — the losing request gets a graceful re-offer, and the DB-level overlap trigger guarantees only one row ever persists for a contested slot.
- **Cancel via manage link:** sets `status = 'cancelled'`, does not delete the row. Manage link survives cancellation and shows a clear "this booking was cancelled" state.
- **Reschedule via manage link:** updates the same row (no duplicate), old slot correctly frees up, new slot correctly locks.
- **"Look up my booking" fallback:** phone OTP re-verification, correctly scoped to only that phone number's upcoming bookings, clean empty state for unknown numbers.

**Schema additions:** `staff_services` (staff-to-service capability mapping, required for "No preference" auto-assignment), `booking_otps`, `booking_tokens`. All `public_*` RPCs backing this feature are locked to `service_role` only — accessed through server-side functions, not directly callable by the browser.

---

## 6. Incidents & Infrastructure Fixes (for the record)

**Security incident — exposed service-role key.** `.env` was git-tracked and, during a period when the repo was made public for code review purposes, the Supabase service-role key was exposed in git history. **Resolved:** rotated to the new-format `sb_secret_...` key, the legacy JWT-based `anon`/`service_role` keys fully disabled in Supabase, `.env` untracked from git with `.env.example` added. No evidence of misuse found.

**Migration pipeline drift.** `supabase db push` reported all original migrations as unrecognized due to a systematic few-second offset between filename timestamps and recorded apply-time versions. Root cause confirmed harmless. Fixed via careful realignment preserving all stored migration SQL history; verified idempotent. `db push` now works cleanly.

**Spec document was never version-controlled.** Discovered during the Phase A wrap-up: this file — the one document explicitly meant to survive across sessions — had been sitting untracked in git the entire time, meaning it was as vulnerable to being silently lost in a branch switch as `.env` was. Now tracked; future updates show up in diffs and commit history like everything else.

---

## 7. Recommended Working Process

1. **Never accept unverified output** — run it, hit the real route, query the real database. Critically: **database-level verification is not sufficient on its own.** Phase A passed every automated and direct-database check, and still had a critical bug (a mandatory deposit being silently skipped) that only a real manual browser walkthrough caught — the server-side logic was correct, but the UI silently dropped fields it didn't know to use. Any user-facing flow needs an actual human click-through, screenshots included, before being called done — not just proof the backend behaves correctly.
2. **Don't stop at the first plausible explanation.** More than once, an initial diagnosis was wrong and only caught because it was pushed to verify further.
3. **Write regression tests for every bug class in Section 4** so they can't silently reappear.
4. **Commit and merge promptly.** Working code left uncommitted or on an unmerged branch is invisible to the running app the moment a branch switch happens.
5. **Spec-first, module-by-module, verify before moving on.**
6. **Payments gets extra paranoia**, more than any module so far: sandbox/test mode only until fully verified, idempotency keys on every payment-writing operation, append-only audit log, extra review pass before touching a real card. Build and ship Phases A → B → C sequentially, never combined into one release.
7. **Never let an agent perform an actual authenticated login on your behalf**, even on test accounts. (Public, unauthenticated flows — like the Self-Booking client walkthrough — are fine for an agent to exercise directly.)

---

## 8. Roadmap

In priority order:

1. ~~Self-Booking~~ — ✅ done (Section 5)
2. **Payments** — Phase A ✅ built against mock provider (Section 9); real Dibsy swap-in pending business registration/sandbox access. Phases B and C specced, not started — do not begin Phase B until Phase A is verified against real Dibsy.
3. **WhatsApp Automation** — 🟡 built except the send (Section 10); unblocking needs a paid Twilio account, not more code. Note the scheduled-job infrastructure this was supposed to reuse **did not actually exist** — Phase A shipped `expire_stale_deposit_holds()` but nothing ever called it. pg_cron is now installed and both jobs are scheduled, so that dependency is genuinely satisfied for the first time.
4. **Packages, Gift Cards & Memberships (client-facing)** — all three fully specced (Section 11). **Gift Cards ✅ shipped. Packages ✅ shipped.** Memberships is the only one of the three still outstanding, and is deliberately blocked on Payments Phase C: it is specced to directly reuse Phase C's recurring-billing mechanics (retry schedule, no-proration model) and should not be started until Phase C is built and proven — building it against unproven billing infrastructure risks re-solving the same dunning/billing-cycle problems Phase C is meant to solve once.

Lower priority, not yet specced: marketing/email campaigns, payroll & commission tracking, digital consent/intake forms, two-way client texting, native mobile app, deeper BI, inter-location stock transfer, labor-law-aware leave tracking.

---

## 9. Payments — Phase A Built (Mock Provider); Phases B/C Specced

**Gateway decision:** **Dibsy** — the single payment provider for the entire product, across all three phases. Qatar-domiciled entity (Paywise QFC Branch), QCB-licensed, PCI-DSS compliant, accepts Visa/Mastercard/NAPS/QNB cards plus Apple Pay/Google Pay/Himyan, markets subscription/recurring billing support, generates shareable payment links. Settlement twice weekly, flat 2.5% + 1 QAR per transaction.

**Confirmed constraint:** Dibsy is online/digital-only — no physical terminals or Tap to Pay/SoftPOS. Deliberate scope decision to stay single-vendor (Phase B) rather than integrate a second provider purely for those two channels.

**Cross-phase architecture:**
- **Webhook-as-source-of-truth**, applied correctly even to the client-facing confirmation screen built during Phase A's UX fixes: it displays "Confirming your payment…" and re-checks rather than asserting success, if the webhook hasn't landed yet by the time the client's browser redirect arrives.
- **Idempotency keys** on every payment-writing operation — verified in Phase A via a literal duplicate-webhook replay test (confirmed exactly one charge recorded, replay correctly refused).
- **Append-only audit log** for every payment/refund event.

### Phase A — Booking Deposits: Built & Verified (Mock Provider)

**Architecture:** Built behind a `PaymentProvider` interface (`createCharge()`, `verifyWebhookSignature()`, `refund()`) so swapping the mock implementation for a real `DibsyPaymentProvider` later is a contained change, not a rewrite. Same adapter pattern already established for SMS (`sms.server.ts`).

**Spec, as built:**
1. Owner sets, per service: flat QAR amount OR percentage (Owner's choice per service), plus `deposit_required` (mandatory/optional).
2. Client-type targeting: deposits can also trigger automatically for **new clients** (no completed appointment history), independent of the per-service rule.
3. Optional-and-skipped deposits show a staff-visible flag on the appointment (same visual pattern as the no-show badge).
4. Deposit counts toward the total — Appointment Complete flow shows deposit-already-collected and the remainder.
5. Refund policy: time-based, Owner-configurable cutoff — full refund before cutoff, forfeited if late/no-show.
6. Refunds are fully automatic on qualifying cancellation via the existing manage-link flow, logged immutably.
7. In-store manual deposit trigger for walk-ins, resolving the amount from the service's own configured rule when no explicit amount is given.
8. **Real DB-level hold:** pending appointments count against the existing `prevent_appointment_overlap` trigger immediately — verified a competing booking attempt against a pending slot is correctly rejected.
9. **Expiry handled two ways:** check-on-read (availability always correct instantly, no dependency on job timing) AND a periodic cleanup job (data hygiene) — both verified independently.

**Four real bugs found and fixed during the build (via direct testing, not code review):**
1. An expiry-check function was incorrectly marked `IMMUTABLE` despite reading `now()` — see Section 4, item 8.
2. A refund-recording RPC failed on an enum-cast error from a `CASE` expression — see Section 4, item 7. This was a genuine silent-money-loss bug: the provider had already refunded before the database write failed.
3. In-store deposit requests were unusable for their primary case (walk-ins with no pre-computed amount) — fixed to resolve from the service's own configured rule.
4. The append-only audit-log guard blocked deletion of any appointment/payment with audit history, because `ON DELETE SET NULL` foreign keys issue an UPDATE the guard correctly rejects — fixed by decoupling the FKs so the log outlives what it describes.

**A fifth, more serious bug found only by a real manual browser walkthrough — not by any database check:**
5. The booking confirmation UI silently dropped the `depositRequired`/`checkoutUrl` fields the server correctly returned, sending clients straight to a "You're booked" screen with **no payment collected at all** on services with a mandatory deposit. The appointment sat in a `pending` hold that would have been silently cancelled ~15 minutes later by the cleanup job — the client would believe they were booked, the slot would quietly vanish, and neither party would find out until the client showed up (or didn't). Caught only because the flow was walked through in a real browser rather than verified via database queries alone — **this is now the canonical example, in Section 7, of why database-level verification is insufficient on its own.**

**UX gaps found in the same walkthrough and subsequently fixed, in priority order:**
1. Added a real post-payment confirmation screen (`/book/:brandSlug/confirmed`) — shows deposit paid, balance due, and frames the manage link as something to save. Waits for real webhook confirmation rather than trusting the redirect (see cross-phase architecture above).
2. Deposit requirement now disclosed *before* checkout — on the service selection card and again on the booking summary, with the action button correctly relabeled ("Continue to payment · [amount]" instead of the misleading "Confirm booking").
3. Manage page now shows the full paid/due breakdown, not just the total price.
4. Fixed a price-rounding inconsistency (displayed rounded prices didn't match the actual charged deposit) by having the database compute and return the exact deposit figure rather than letting the UI recompute it — avoiding a second implementation of the same money rule.
5. Fixed a broken logo image across all public pages (pre-existing, unrelated to Payments, fixed opportunistically) — required a mount-time check rather than a plain `onError` handler, since the image fails before React hydration attaches any handler on a server-rendered page.

**Known untested gap, flagged deliberately rather than glossed over:** the "Confirming your payment…" pending state (for when a client's browser redirect arrives before the async webhook does) has only been exercised in the mock provider's instant-redirect case. This needs deliberate testing against real Dibsy sandbox timing once that's available — it's architecturally correct but genuinely unproven under real async delay.

### Dibsy Swap-In Checklist (for when sandbox access exists)

Honest, specific unknowns flagged during the mock build — confirm each against Dibsy's actual documentation before or during the swap-in, don't assume:

1. **Signature scheme.** Mock uses a Stripe-style `t=<ts>,v1=<hmac>` format over `${ts}.${body}` with a 300s tolerance window. Dibsy's actual header name, canonical string format, and tolerance will differ — confirm against their real webhook docs.
2. **Idempotency key handling.** Mock generates its own key and expects the provider to honor it. Some gateways ignore client-supplied keys or use their own header/mechanism instead — confirm which applies to Dibsy, and reconcile both if needed.
3. **Refund timing — likely the highest-risk item.** Mock refunds resolve synchronously. Dibsy refunds are likely asynchronous, meaning the current webhook branch for `refund.succeeded` (treated as informational only) will need to become authoritative instead — the same discipline already applied to charge confirmation.
4. **Amount units.** Mock uses decimal QAR (`numeric(10,2)`). Confirm whether Dibsy expects minor units (integer) instead — if so, conversion belongs in the adapter layer, not the schema.
5. **Metadata round-trip.** Mock assumes metadata is echoed back on the webhook. If Dibsy doesn't do this, correlation must rely solely on the provider's own transaction reference — already supported as the primary lookup key, so this is a fallback confirmation, not a blocker.
6. **`charge.failed` semantics.** Mock deliberately leaves a hold alive on failure so the client can retry within the window — confirm Dibsy doesn't send a terminal failure state that should release the hold immediately instead.
7. **The untested pending-confirmation UI state** (above) — deliberately test this against real async webhook delay, not just the instant mock case.

### Phase B — In-Salon Checkout (Specced, Not Built)

Do not start until Phase A is verified against real Dibsy.

1. **Channels: QR-code checkout + WhatsApp payment links only.** Physical terminals and Tap to Pay are explicitly out of scope — Dibsy doesn't support them, and staying single-vendor was a deliberate choice over integrating a second provider (e.g. SADAD, Tap Payments) purely for those two channels.
2. **Manual "Request payment" trigger**, decoupled from marking the appointment "Completed."
3. **No separate "staff-assisted" code path** — same Dibsy-hosted checkout link/QR regardless of whose device the client uses.
4. **No expiry on the payment request.** Appointment shows a visible "payment requested — awaiting payment" status instead, feeding a future Reports view of outstanding balances.
5. **Manual cash/card-elsewhere logging always stays available**, and automatically cancels any outstanding Dibsy request for that appointment when used.
6. **Requested amount is editable** by staff (tips, add-ons, discounts) with an adjustment note for traceability.
7. **Fully automatic bookkeeping** — webhook confirmation writes `income_records` directly; `payment_method` enum gains a Dibsy value.

### Phase C — Subscription Billing (Specced, Not Built)

1. **Onboarding stays untouched** — no payment step added. Trial-first; payment details requested later.
2. **Status tracking automated; enforcement stays manual for now**, deliberately, given the current relationship-driven pilot-salon stage.
3. **Automatic retry schedule for failed charges** (e.g., day 1/3/7) — validate against Dibsy's native recurring-billing retry handling before building a custom scheme.
4. **Plan changes are not prorated** — new limits apply immediately, billing catches up at the next renewal.
5. **New schema needed:** saved payment method reference (tokenized, never raw card data), billing/invoice history, retry-attempt tracking.

---

## 10. WhatsApp Automation — Built Except the Send

### Build status

Everything below was implemented and verified **except the outbound message itself**, which is blocked by the Twilio account tier rather than by anything in this codebase.

**Working and verified:**
- Schema: consent columns + timestamps + source on `clients`, `reminded_at` on `appointments`, `whatsapp_templates`, `whatsapp_messages` audit log, brand-level `whatsapp_enabled` and `reminder_lead_hours`.
- RPCs: consent set/grant, opt-out and opt-in by phone, template resolution, due-reminder query, mark-reminded, message logging. All revoked from `anon`/`authenticated` and granted to `service_role` only, matching the `public_`/`payment_` convention.
- Consent capture in **both** booking flows (public Self-Booking and staff entry), unchecked by default.
- Staff opt-out toggle on `/app/clients/:id`, showing both opt-in and opt-out timestamps.
- Settings UI for reminder lead time — **plus the four booking-window/deposit fields that already existed in the database and were enforced server-side but had no UI at all**, so an Owner could not see or change them. That was a pre-existing gap, unrelated to WhatsApp, found while adding the lead-time control.
- Inbound webhook with Twilio signature verification (rejects unsigned payloads with 403, verified).
- Reminder sweep endpoint, shared-secret guarded (rejects without the secret with 403, verified), running end-to-end against the live database.
- **pg_cron + pg_net installed and both jobs scheduled.**

**Blocked — the send step only.** Twilio returns **error 21654, "ContentSid Required"**, for business-initiated WhatsApp messages. Trial accounts cannot create or use approved Content templates, and there is no workaround at that tier — the plain-`Body` fallback only delivers inside an open 24-hour session window, which does not apply to a confirmation or a reminder. **This needs a paid Twilio account plus Meta template approval, not a code change.** The adapter already handles both paths: once a `content_sid` is stored per brand in `whatsapp_templates`, the approved-template path activates with no deploy.

Consequence worth knowing: every send currently records a `failed` row in `whatsapp_messages` with the 21654 reason. That is the audit log doing its job, not a regression.

### ⚠ Deferred — must be done when the real send is unblocked

**The deposit-path booking confirmation is not emitted from the payment webhook yet.** For a no-deposit booking the confirmation is attempted inline at booking time, but a deposit booking is only `pending` at that moment, so consent is recorded and the message is deliberately deferred (`sendConfirmation: false`). **Nothing currently sends it once the payment succeeds** — the webhook records the payment and stops there. Verified in a browser walkthrough on 2026-08-02: after a completed mock deposit payment, `whatsapp_messages` held zero rows for that appointment. This is invisible today because no send works at all, and it will stay invisible after Twilio is upgraded unless it is explicitly wired — deposit-paying clients would simply never get a confirmation, while everyone else does. **Wire `recordConsentAndConfirm`/`dispatchAppointmentMessage` into the payment webhook's success path at the same time the paid Twilio account lands.** Reminders are unaffected — the sweep picks up these appointments normally.

### Deviations from the original spec, and why

- **Consent is recorded even when a deposit is required.** The spec didn't distinguish. A deposit booking is only `pending` when the client ticks the box, so consent is stored immediately (they did consent) but the confirmation message is deferred — sending "your booking is confirmed" before the payment cleared would be false. The reminder sweep is unaffected either way, since it queries live status.
- **Consent grants but never revokes.** An unticked box on a later booking leaves an existing opt-in untouched. Revoking is a deliberate act only: the staff toggle, or replying STOP. Otherwise a client who opted in once would be silently opted out by any subsequent booking where staff forgot to tick.
- **STOP applies across every brand sharing that phone number.** The person opting out has no concept of our multi-tenant brand separation; honouring it per-brand would keep messaging someone who asked us to stop.
- **A brand-level `whatsapp_enabled` master switch was added** (not in the original spec). Turning it off stops all messaging for the brand without touching any client's own consent record — the two are genuinely different states and collapsing them would destroy consent evidence.

### Original specification

**Provider:** **Twilio**, confirmed — consistent with the original implicit reference in Core Decision #11, and chosen for its comparatively mature, well-documented WhatsApp Business Platform integration (a deliberate contrast to the webhook-format guessing flagged as a real risk for Dibsy).

**Scope: both booking confirmations and appointment reminders**, built in that sequence within one overall effort — confirmation first (simplest: reuses the same trigger point as the existing SMS OTP delivery, single event, no new scheduling infrastructure needed), reminder second (needs a new periodic scheduled job).

**Consent — explicit opt-in required, not implied:**
1. A clear opt-in checkbox ("Send me WhatsApp updates about this appointment") required at booking time, in **both** the public Self-Booking flow and internal staff-entry flow. This is a genuine WhatsApp Business Platform policy requirement, not just a UX nicety — unsolicited business-initiated messaging risks the WhatsApp Business number being restricted by Meta, which would break the feature for every brand on the platform at once.
2. Consent is a **standing preference on the shared `clients` record** (brand-wide, per Core Decision #4), not re-asked at every booking.
3. Opt-out: mandatory "reply STOP" handling (a genuine Meta platform requirement regardless of any other decision here) flips `clients.whatsapp_opt_in` to false and suppresses future messages, **plus** a staff-facing manual toggle on `/app/clients/:id` for the common real-world case of a client asking to stop in person or by phone rather than texting STOP themselves.

**Reminder timing:** single, Owner-configurable lead time (e.g., "remind clients 24 hours before," pre-filled with 24h as the default), added to the same Settings screen as the existing booking-window and deposit-cutoff settings. Two-reminder support (day-before + same-day) deliberately deferred — worth adding later only once real no-show data shows a single reminder isn't sufficient.

**Trigger mechanism — periodic scheduled sweep, not per-appointment timers:**
- A job runs on a regular interval (e.g., every 15–30 minutes), querying live for `scheduled` appointments falling within the configured reminder window that haven't been reminded yet, sends the message, and marks them as reminded to prevent duplicate sends.
- **Reuses the same underlying scheduled-job mechanism as the Phase A deposit-hold cleanup job** — build one, and the pattern for the other is already proven.
- **Race safety (reschedule/cancellation during the reminder window):** handled by querying live `status`/`starts_at` at the moment the job runs, the same "trust a live query over stale state" principle already applied to the appointment overlap trigger and the deposit-hold expiry check. No additional synchronization needed — a cancelled appointment simply won't match the query when the job next runs.

**New schema needed:** `whatsapp_opt_in` (boolean) + opt-in timestamp on `clients`; a `reminded_at` (or similar) field on `appointments` to prevent duplicate reminder sends; Twilio message template IDs/references for the two message types, pending Meta template approval.

---

## 11. Packages, Gift Cards & Memberships — Packages & Gift Cards Shipped, Memberships Specced

Client-facing, purchasable products — distinct from the existing internal `services` catalog (Owner-managed pricing/bundling, not something a client buys as a product in its own right). All three share a purchase-channel sequencing decision, covered once below rather than three times.

**Shared decision — purchase channel:** all three are **staff-initiated first**, with client self-service explicitly planned as a fast-follow rather than built now. Staff-initiated reuses existing internal infrastructure (income logging, client profiles, and — for Memberships specifically — Phase C's saved-payment-method mechanism) with no new public-facing surface required. Self-service depends on either Phase B's in-salon Dibsy pattern being generalized into a public purchase flow, or its own dedicated build, and is deliberately out of scope for this first pass on all three.

### Packages — ✅ Shipped

Multi-service bundles a client pre-pays for and redeems over future appointments (e.g., "Bridal Package: 1 haircut + 2 facials + 1 manicure").

**Built as specced below**, plus the decisions recorded in "As built" at the end of this subsection.

1. **Multi-service, not single-service.** A package can bundle several different services, each tracked with its own independent remaining count — not a single-service-only model.
2. **Expiry: Owner-configurable per package type** (e.g., "expires 6 months after purchase"), applied at time of purchase. Not per-individual-sale — one setting per package definition.
3. **Expired-with-balance handling:** no automatic action. Shows as a staff-visible flag on the client's profile and in a dedicated Owner report of expired packages with unused sessions — gives the Owner/Manager visibility to decide case-by-case, but nothing happens automatically.
4. **Redemption: automatic detection with override.** When a Receptionist/Manager selects a client + service during booking or at checkout, if the client has an active, non-expired package covering that exact service with remaining balance, the system defaults to "Redeem from package (X of Y remaining)" — easily switched off if the client wants to pay separately that visit.
5. **Refund policy:**
   - **Zero sessions redeemed** → full refund allowed.
   - **One or more sessions redeemed** → purchase becomes non-refundable. Instead, Owner/Manager can manually extend the package's expiry date as a discretionary goodwill action — deliberately chosen over automated proration math, which was rejected as adding real complexity (weighted-by-service-price calculations, edge cases around price changes) for a scenario expected to be rare in practice.

**Schema, as built:** `package_types` (brand-scoped definition: name, description, price, nullable `expiry_months`, active/inactive status) and `package_services` (line items: service + `included_count`, unique per service so one balance can never split across two rows). Purchases are `client_packages` (client, type, `price_paid`, computed `expires_at`, status) with `client_package_service_balances` holding `remaining_count` **and** `included_count` per service, and `package_redemptions` as the append-only event log. `income_records` gained a nullable `client_package_id`, and its source CHECK was rebuilt to cover `package_sale` and `package_refund`. `appointments` gained a nullable `client_package_id`.

**As built — decisions worth carrying forward:**

1. **Revenue is recognised once, at the sale — never again at redemption.** Identical rule to Gift Cards, and deliberately so: a second money model for a second prepaid product is how the two drift apart. Redemption debits a session and writes a `package_redemptions` row but logs **no** `income_records` row. `appointment_settle` now draws on package → gift card → cash collected today in one transaction, and logs only the cash portion as income. Verified: the redeemed appointment had zero income rows against it.
2. **Detection happens at booking *and* checkout; the debit happens only at checkout.** The spec asks for detection in both places, which is a UI affordance, not two debits. Decrementing at booking would burn a session on any visit later cancelled or no-showed and would need a reversal path to undo it — the compensating-write complexity bug class 3 warns about. Booking therefore writes `appointments.client_package_id` as *intent only*; checkout pre-selects from it and performs the single real decrement, then overwrites that column with whatever actually covered the visit, so a package switched off at the till never leaves a stale claim of coverage behind.
3. **The package covers a service session, so the database computes what that session is worth.** `service_effective_price()` resolves the per-location override and the redemption records that figure as `covered_amount`. The UI never recomputes it — this is Section 9's UX fix #4 (the deposit rounding mismatch) applied up front rather than after a bug report.
4. **`package_redeem` is `service_role` only** — deliberately tighter than `gift_card_redeem`, which `authenticated` may call directly. Its one legitimate caller is `appointment_settle`, which reaches it as SECURITY DEFINER. Granting it more widely would let a client-side bug burn a prepaid session without completing the appointment that justified it.
5. **`price_paid` is snapshotted onto the purchase, not read back through `package_type_id`.** A refund must return what the client actually paid; reading the live definition would return whatever the Owner has since repriced it to. That bug would only appear after the first repricing, long after the code looked correct.
6. **Refunds are a negative contra `income_records` row, not a deletion or an edit.** The sale genuinely happened, and every other money table here is append-only. The reversal defaults to the method the sale was logged under so the books balance per method rather than quietly moving money between cash and card. Balances are also zeroed on refund, so a refunded package cannot be offered at checkout even if some later read path forgets to filter on status.
7. **Expiry is a live check, never the stored status** — on the redeem path, the offer/detection query, the Owner report, and the client-profile summary. A package can legitimately sit at `status = 'active'` with a past `expires_at`; that is correct, not drift. No cron job is involved, matching Gift Cards and the deposit-hold expiry.
8. **Withdrawing a package type from sale does not touch packages already sold.** Only new sales are blocked. Selling a definition with no services at all is refused outright (`package_empty`) rather than creating a purchase with nothing to redeem.

**Verified by browser walkthrough**, not by database queries alone: multi-service sale creating independent per-service balances; redemption decrementing one service while leaving the other untouched, atomic with completion, writing no income; refund blocked once any session is used with the extend-expiry path working in its place; full refund succeeding while unused; and an expired package with sessions left disappearing from the checkout offer while still appearing in the Owner report and on the client profile.

**Fixed here, though it predated Packages:** settling an already-completed appointment re-ran the entire settlement. See Section 4 bug class 9 — it is a general rule about money-writing RPCs, not a Packages detail.

### Gift Cards — ✅ Shipped

Stored monetary value, purchasable by anyone (often not the eventual redeemer — a gift, by definition), redeemable against anything.

**Built as specced below**, plus the decisions recorded in "As built" at the end of this subsection.

1. **Denominations: both suggested and custom.** Owner sets a few standard suggested amounts (e.g., 100 / 200 / 500 QAR) shown as quick options at time of sale, but any custom amount is always allowed too.
2. **Expiry: Owner-configurable**, same mechanical pattern as Packages. **Flag for the Owner, not a technical caveat:** gift card expiry is more likely to intersect with local consumer-protection rules than package expiry (a gift card represents money already paid in full, not a discounted bundle) — worth the Owner confirming Qatar's actual rules on this before enabling it in production, since neither this spec process nor the eventual build can verify that on the Owner's behalf.
3. **Redemption scope: fully unrestricted.** No category restrictions — a gift card applies to any service, any amount, and can even be used toward a Package purchase. (A future "restrict to category X" need is a different feature — a targeted discount/voucher — not something to bolt onto gift cards.)
4. **Identification: unique code, linked to a client at redemption.** Each gift card gets a unique generated code at time of purchase (deliverable via WhatsApp/email/printed, whatever the salon does), independent of any `clients` record — the buyer doesn't need to specify a recipient at purchase time. At redemption, staff enter the code, and it gets linked to whichever `clients` record actually uses it (creating a new client record if the redeemer isn't already one), the same way any other new-client flow works.

**Schema, as built:** `gift_cards` (brand-scoped, unique code, `initial_amount`, `remaining_amount`, currency, `expires_at`, status enum, nullable `client_id` linked at first redemption, `sold_by`) and `gift_card_redemptions` (append-only, linking a card to the appointment, client, amount, and redeeming staff member). `income_records` gained a `source` discriminator and a nullable `gift_card_id`.

**As built — decisions worth carrying forward:**

1. **Revenue is recognised once, at the sale — never again at redemption.** This is the single most important decision in the module. A gift card is money that arrives when the card is sold; counting it again when it's spent would double-count every riyal. Redemption therefore writes a `gift_card_redemptions` row and settles the appointment, but deliberately logs **no** `income_records` row of its own. The appointment's own income record reflects what was actually collected by other means that visit, so brand revenue stays a single honest number regardless of how much of a visit a gift card covered.
2. **Expiry is a live check, never the stored status.** `gift_card_redeem` compares `expires_at` against `now()` at redemption time, `gift_card_lookup` returns a computed `effective_status` alongside the stored one, and the Owner report queries expiry directly. A card can legitimately sit at `status = 'active'` with a past `expires_at` — that is correct, not drift. This follows Section 4 item 8: the expiry predicate is shared between the redeem path and the read path, exactly the situation where a stale constant-folded answer would make both agree on something wrong.
3. **Partial redemption across multiple visits** works against `remaining_amount`, with the card flipping to `redeemed` only when the balance reaches zero. Verified across two separate visits against one card.
4. **`gift_card_generate_code` is not granted to `authenticated`** — internal only. Exposing it would let any signed-in user mint codes. The customer-facing RPCs are granted to `authenticated` and rely on their internal `auth.uid()` / `is_brand_member` checks, matching the existing convention.
5. **The expired-with-balance report excludes Staff/Technician**, consistent with Core Decision #17's narrower visibility for that role.

**Still open:** the Owner-facing consumer-protection question flagged in item 2 above is unchanged by the build — Qatar's actual rules on gift card expiry still need the Owner's confirmation before expiry is enabled in production. The code supports a null expiry (never expires), so shipping without it is a configuration choice, not a code change.

### Memberships

Recurring client-paid subscription unlocking an ongoing benefit — depends on Payments Phase C.

1. **Benefit types — Owner's choice per tier, two distinct mechanics (not a generic rules engine):**
   - **Percentage discount on everything** — applied automatically at every checkout for the life of the membership.
   - **Included services per billing period** — a specific service (or set of services) included free each period.
2. **Rollover for the included-services tier type — Owner's choice per tier:**
   - **Reset** — unused included visits are simply lost at period end (the default, standard pattern).
   - **Rollover with a mandatory Owner-configurable cap** — unused visits accumulate up to a set maximum, then further accumulation stops (uncapped rollover was explicitly rejected as unbounded business liability).
3. **Billing mechanics: full reuse of Payments Phase C**, minus the trial concept (a client membership is paid from day one, unlike Owner brand onboarding which gets a trial period). Same retry schedule (day 1/3/7 style), same no-proration model (tier changes apply limits/benefits immediately, billing catches up at next renewal), same webhook-confirmed payment pattern. Deliberately not re-specced from scratch — Phase C will already have solved recurring-charge/dunning correctly, and reusing it avoids a second, parallel set of edge cases to get right.
4. **Enrollment: staff-initiated, triggered proactively.** A staff-facing prompt appears on a client's profile after their **first completed appointment**, suggesting "offer a membership" — timed to the moment a retention pitch is most likely to land, without ever bypassing actual consent-based enrollment. This is explicitly *not* automatic enrollment: a membership requires the client's real payment details and explicit consent to recurring billing, the same as any other Dibsy charge in this product — no client is ever silently opted into paid recurring billing.

**New schema needed:** a membership-tier definition table (brand-scoped, benefit type, discount % or included-service config, rollover cap if applicable, price, billing interval); a client-membership-enrollment table (active tier, status, saved payment method reference, next billing date, retry-attempt tracking — mirroring Phase C's own schema needs); a mechanism on the client profile to surface the first-completed-appointment enrollment prompt (likely a simple computed flag: has one completed appointment, no active membership yet).

---

## 12. Pre-Launch Checklist — must be cleared before the first real customer

Things that are **safe today only because there are no paying customers**. Each
one is a live defect the moment someone signs up under the new pricing. This is
not a roadmap; nothing here is optional.

### ☐ Backfill mirrored plan limits on brands created before 2026-08-05

`brands.max_locations` and `brands.max_staff_accounts` are a **snapshot written
at plan-change time**, not a lookup. `enforce_location_plan_limit` and
`enforce_staff_plan_limit` read those columns, not `src/lib/plan-limits.ts`. So
redefining what a tier *means* does not reach a brand already sitting on it —
the brand keeps whatever numbers were mirrored onto it when it was created or
last saved in `/admin`.

The 2026-08-05 restructure changed every tier, so every pre-existing brand is
now mis-limited against its own plan. Observed live during that work: a brand
on `growth` still carried `max_staff_accounts = 10` from the old structure
while the pricing page advertised 20. Another brand only became correct because
it happened to be re-saved during testing.

**The failure mode is the dangerous kind — silent and in the customer's
disfavour.** They are billed for the tier they bought, the marketing page
promises the new allowance, and the database enforces the old smaller one. They
hit a wall the product told them they would not hit, and nothing raises an
alert; the trigger just refuses the insert.

No backfill shipped with the restructure, deliberately: blanket-rewriting every
brand's limits would clobber any bespoke allowance granted by hand, and with
zero customers the safer move was to leave it explicit rather than guess.

Resolve by **either**:
- re-saving each brand in `/admin` (fine while the brand count is tiny — it
  rewrites the limits from `PLAN_LIMITS` as a side effect of the save), **or**
- a targeted migration that updates only brands whose stored limits still match
  the *old* tier values exactly, leaving anything bespoke untouched.

Verify afterwards that no brand's stored limits disagree with
`PLAN_LIMITS[plan]` unless that difference is a deliberate, recorded exception.

### ☐ Decide what happens to Growth brands with 2–3 locations

Growth dropped from 3 locations to 1 in the same restructure. Existing Growth
brands above the new ceiling are not broken — the location trigger only fires
on INSERT — but they cannot add another branch. Grandfather them, issue
complimentary `addon_locations`, or move them to Professional. Pick one before
anyone is affected.

### ☐ Decide what to do with 103 historical appointments assigned to non-Staff

The 2026-08-06 bookable-staff restriction deleted the 22 **scheduled** appointments
assigned to an Owner/Manager/Receptionist, but deliberately kept the 103
historical ones (completed / cancelled / no_show). Deleting those would have
cascaded into `income_records` — 67 rows, 11,886.21 QAR, roughly half of all
recorded revenue — because `income_records.appointment_id` is `ON DELETE
CASCADE`.

They are harmless to booking: the trigger only fires on INSERT/UPDATE of the
assignment, so nothing can re-assign them and nothing new can join them. But
**per-staff Reports still attribute that revenue to people who are not staff**,
which will read as nonsense the moment a real Owner opens Reports. Either
reassign them to genuine Staff accounts, exclude non-Staff assignees from the
staff-performance report, or accept it as seed-data noise and wipe the test
brands before launch. This is only cosmetic while the data is fake.

### ☐ Re-check the billing guard after any change to brands' RLS or grants

`guard_brand_billing_columns` is what makes every plan limit real rather than
advisory (Section 4, bug class 12). Run
`supabase/tests/billing_guard_regression.sql` after any change to `brands`
policies, grants, or trigger set — it is the only check that catches a guard
which fails open.

---

## 13. Staff Profiles — Shipped

Full staff profile at `/app/staff/:id`: header, personal details, location +
transfer + history, per-location performance, leave, and the weekly-hours editor
folded in from `/app/staff/:id/schedule` (that route still works and now shares
the same components rather than holding a second copy).

**Three tables, and the split was forced rather than chosen.** The brief asked
for `photo_url` to live on `staff_personal_details` and be readable brand-wide
while the rest of the row stayed restricted. Postgres cannot express that — RLS
filters rows, never columns (bug class 10). A SELECT policy grants the whole row
or none of it, and column-level `GRANT`s are per-database-role, not
per-caller-condition. So the photo lives in `staff_photos` (brand-wide read,
Owner/Manager write) and `staff_personal_details` holds only the sensitive tier.
Anyone tempted to "simplify" these back into one table should read this twice.

**Manager PII scope is location-only, and this is settled — not an oversight.**
The original brief said Owner/Manager of the staff member's *brand*. Brand-scoping
Managers would let the Manager of one branch read the QID, home address and DOB
of a stylist at another branch they have never met, which is hard to defend under
the PDPPL's data-minimisation posture. `can_view_staff_pii()` therefore gives
Owners brand-wide access and Managers their own location only. One function,
called by all four policies *and* by the UI, so the page and the database can
never disagree about who may see a national ID.

⚠ **Confirmed by the owner on 2026-08-06, after the deviation was flagged.** It
reads like a bug against the original brief and it is not one. Do not "restore"
brand-wide Manager access on the strength of the brief text alone — widening this
is a decision about real people's identity documents, not a spec-conformance fix.
If it is ever genuinely wanted, it is a one-line change to `can_view_staff_pii()`
and it needs its own explicit sign-off, because the reverse direction —
discovering it was too broad once a real salon's staff records are in the table —
cannot be undone.

**`photo_path`, not `photo_url`.** The bucket is private, so the only URL that
could be stored is a signed one — and signed URLs expire. Persisting one persists
a value that stops working within the hour. The stable fact is the object path;
the client mints a short-lived signed URL at render time.

**Storage, first use in this project.** Bucket `staff-photos`: private, 5 MB cap,
JPEG/PNG/WebP only. Path convention `{brand_id}/{user_id}` — brand first because
the policies parse `(storage.foldername(name))[1]` to decide access, and a
user-first path would leave them unable to tell which brand an object belongs to.
The `ON CONFLICT` clause re-asserts `public = false` on every apply so the bucket
cannot drift public.

**`transfer_staff_location`** does three writes — close the open history row,
open a new one, repoint `user_roles.location_id` — in one SECURITY DEFINER
function, because doing them as three client calls is bug class 3. It takes an
advisory lock on the staff member before reading their current location (bug
class 11), returns `no_change` rather than writing a zero-length stint, and
authorises from `auth.uid()` and JWT claims, never `current_user` (bug class 12).
Owners may target any location in the brand; Managers only a location they run,
so a Manager can pull someone in but never push someone out.

**Appointments are deliberately untouched by a transfer.** They carry their own
`location_id`, so work done at a branch someone has since left stays credited to
that branch. Verified by moving a stylist and confirming the per-location
breakdown was byte-identical before and after.

**Operational consequence worth knowing:** `staff_schedules` are per-location, so
a transferred stylist has no working hours at the new branch until someone sets
them — and therefore no self-booking availability there. The transfer toast says
so; it is not a bug.

---

*Update this file after each new feature is specced or shipped.*
