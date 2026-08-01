# Q-Salon Suite — Project Spec & Handoff Document

*Living document. Update after every major Claude Code session so "what's shipped" stays accurate.*

---

## 1. Product Summary

Multi-tenant SaaS for beauty salon chains in Qatar. Owners subscribe (monthly/yearly, manual billing in v1) and manage multiple locations under one Brand. Role-scoped staff accounts (Owner, Manager, Receptionist, Staff/Technician) handle appointments, clients, stock, and services with Postgres RLS enforcing all access boundaries.

**Stack:** React + TanStack Router/Start (file-based, nested routes, SSR + server functions) + Supabase (Postgres, Auth, RLS). Originally built in Lovable; now developed in Claude Code against a GitHub repo. Region: Mumbai (ap-south-1).

---

## 2. Core Decisions (from original planning interview — still governing)

1. Hierarchy: Owner → Salon Brand → Locations (many). One subscription per Brand.
2. Plans: Starter (1 location / 3 staff, excl. Owner), Growth (3 locations / 10 staff), Enterprise (unlimited — represented as 999/999). Enforced at the DB level via triggers.
3. Roles: Owner, Location Manager, Receptionist, Staff/Technician — fixed, not a custom permission builder.
4. Clients: shared brand-wide (not siloed per location); appointments/transactions still tagged per-location.
5. Stock: shared product catalog brand-wide; quantity tracked per-location.
6. Services/pricing: shared catalog; Owner-only per-location price overrides. Pricing is shown client-facing on the Self-Booking flow — no longer purely internal.
7. Income: manual logging (amount + payment method label) as the default; **now being extended with real payment processing — see Section 9.**
8. Subscription billing: manual/offline today; **automation planned — see Section 9, Phase C.**
9. Platform Admin: separate internal tool, outside customer-facing RLS, gated by a `platform_admins` allowlist table.
10. Language: English-only UI chrome; Arabic-capable data fields (`dir="auto"`).
11. Notifications: manual `wa.me` link only — no automated messaging yet (WhatsApp Automation is next on the roadmap after Payments).
12. Scheduling: basic conflict prevention (staff working hours + leave), hard DB block on double-booking.
13. Client profile: text-only (no photos) + structured per-visit service record.
14. Reports: revenue, stock, staff performance — no profitability/margin math yet.
15. No-shows: tracked and visible as a count/badge on the client profile.
16. Staff account creation: Owner creates Managers; Managers create Receptionist/Staff scoped to their own location only.
17. Staff calendar visibility: Staff/Technician sees only their own appointments, not the full location calendar.
18. Currency: `currency` column on all money tables, defaulted to `'QAR'`.
19. Data residency: Supabase project in Mumbai region.

---

## 3. Modules Shipped

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
| 10 | **Payments — Phase A (Booking Deposits)** | 🟡 **Built and verified end-to-end against a mock provider; not yet swapped to real Dibsy.** All internal logic (deposit rules, slot holds, expiry, refund policy, webhook verification, audit log) is done and tested. What remains is a `DibsyPaymentProvider` implementing the existing `PaymentProvider` interface, plus the swap-in checklist in Section 9. |
| 11 | **Payments — Phases B & C (In-Salon Checkout, Subscription Billing)** | 📋 **Fully specced, not yet built.** See Section 9. Per Section 7, do not start B until A is running against real Dibsy. |

---

## 4. Known Working Patterns & Bug Classes to Watch For

These are lessons earned the hard way — worth checking for explicitly in every future module, not just fixed once and forgotten.

1. **Missing `<Outlet />` on nested/parent routes.** Found and fixed twice: first in `app.tsx` (blocked all of `/app/*`), then again in `app.clients.tsx`, `app.staff.tsx`, and `book.$brandSlug.tsx` (blocked client/staff detail pages and the booking lookup page — the second occurrence had been live and unnoticed since those modules originally shipped). **Any new parent route with child routes must be checked for this explicitly**, and — critically — must be re-verified after any commit/merge/branch switch, since it's possible for a correct fix to exist on one branch while the actually-running dev server serves an older, unfixed branch. Verify against what's actually running, not just what's in a merged PR.
2. **`pgcrypto` functions live in the `extensions` schema, not `public`.** A `SECURITY DEFINER` function with `SET search_path TO 'public'` will fail on unqualified `crypt()`/`gen_salt()`/`gen_random_bytes()` calls. Always fully qualify (`extensions.crypt(...)`) — do not widen the search_path as the fix, since that's a security regression for SECURITY DEFINER functions.
3. **Client/data rollback scope in multi-step RPCs.** `public_book_appointment` originally inserted the client row *before* the exception-handled block wrapping the appointment insert, so a `slot_taken` failure rolled back the appointment but left an orphan client row. Any RPC doing multiple related inserts needs every insert that should be atomic together inside the same exception scope. **This applies directly to Payments** — any RPC touching both an appointment/deposit state and a payment record needs the same atomic-scope discipline.
4. **Generic error messages hide real causes.** Fixed multiple times independently: the `err instanceof Error` pattern (Supabase/PostgREST errors are plain objects, fixed via a shared `errorMessage()` helper), and a static `errorComponent` on a TanStack Router route that always showed the same text regardless of the actual thrown error. Always surface the real error, at least in non-production contexts.
5. **`supabase db push` / migration drift.** Root cause was historical, not ongoing: Lovable-applied migrations recorded `version` at apply-time (a few seconds after the filename's declared timestamp), making every migration look "foreign" to the CLI. Fixed via careful realignment (see Section 6). Going forward, all new migrations should be created and applied via the Supabase CLI to avoid reintroducing this drift.
6. **`.env` hygiene.** `.env` was tracked in git and briefly exposed a real Supabase service-role key (see Section 6 for the full incident). Now gitignored with a `.env.example` template. **Known hazard:** if `.env` was ever tracked historically, a `git reset --hard` to a commit before it was untracked will delete the local file — keep a backup of real key values somewhere outside git (e.g. a password manager) rather than relying on the working copy alone.
7. **Enum columns written through a `CASE` expression.** Postgres types a `CASE` by its *result*, not by the individual literals inside it, and that result is `text`. Writing `CASE WHEN x THEN 'succeeded' ELSE 'failed' END` into an enum column fails with `42804: column "…" is of type … but expression is of type text`, even though each literal on its own would have been inferred correctly. Always cast the whole expression: `(CASE … END)::public.my_enum`. **Why this one is dangerous rather than merely annoying:** it only fires on the branch that actually executes, so a rarely-taken path can pass every review and every happy-path test, then throw in production. It was found in `payment_record_refund`, where the provider refund had already succeeded — money left the gateway, the client was refunded, and the system recorded neither the refund nor the state change. Applies to any conditional enum write anywhere in the schema, not just payments.
8. **`IMMUTABLE` on a function that reads `now()` (or any changing state).** `IMMUTABLE` is a promise to the planner that output depends solely on the arguments, which licenses constant-folding and caching of the result. A function that consults `now()`, a table, or a setting is at most `STABLE`. Postgres does **not** validate this at creation time — it accepts the wrong label silently and the bug surfaces later as a value that "sticks" when it should have changed. Found on `appointment_holds_slot`, where a mislabelled expiry predicate could have kept treating an expired slot hold as live (or the reverse) within a plan. **Rule of thumb:** `IMMUTABLE` only for pure arithmetic/string functions over their arguments; `STABLE` the moment `now()`, a query, or a GUC is involved. This matters most for predicates shared between a trigger and a read path, since the two can silently disagree.

---

## 5. Self-Booking Portal — Shipped & Verified

**Public entry:** `/book/:brandSlug` (brand-level link, location selection as step one, auto-skipped for single-location brands, deep-linkable via `?location=`).

**Verified working end-to-end, including edge cases:**
- Real data loads correctly (locations, services with effective per-location pricing, staff).
- Staff selection: both a specific named staff member and "No preference" (auto-assignment) — confirmed the auto-assign logic genuinely distributes between real qualified candidates via `staff_services`, not just defaulting to one.
- Availability computed live against `staff_schedules` + `staff_leave` + existing `appointments`, respecting Owner-configurable min-notice/max-advance settings.
- Phone OTP verification (dev-mode fallback shows the code on-screen when SMS/Twilio isn't connected — real provider integration still pending).
- Booking creates a real `appointments` row, `status = 'scheduled'`.
- **Race-condition handling:** verified by deliberately winning a slot with a competing request mid-flow — the losing request gets a graceful re-offer (fresh slots shown, no dead-end), and the DB-level overlap trigger guarantees only one row ever persists for a contested slot.
- **Cancel via manage link:** sets `status = 'cancelled'`, does not delete the row. Manage link **survives** cancellation and shows a clear "this booking was cancelled" state rather than a dead link.
- **Reschedule via manage link:** updates the same row (no duplicate), old slot correctly frees up, new slot correctly locks.
- **"Look up my booking" fallback:** phone OTP re-verification, correctly scoped to only that phone number's upcoming bookings, clean empty state for unknown numbers.

**Schema additions:** `staff_services` (staff-to-service capability mapping, required for "No preference" auto-assignment), `booking_otps`, `booking_tokens`. All `public_*` RPCs backing this feature are locked to `service_role` only — accessed through server-side functions, not directly callable by the browser.

**Still open / not yet done:**
- Real SMS provider (Twilio) not yet connected — dev-mode on-screen OTP code is the current fallback.
- ~~No payment/deposit collection at booking time~~ — added by Section 9 Phase A, now built against a mock provider. The booking flow returns a checkout URL and holds the slot at DB level while payment is pending; a signed webhook is the only thing that confirms it.

---

## 6. Incidents & Infrastructure Fixes (for the record)

**Security incident — exposed service-role key.** `.env` was git-tracked and, during a period when the repo was made public for code review purposes, the Supabase service-role key was exposed in git history. **Resolved:** rotated to the new-format `sb_secret_...` key, the legacy JWT-based `anon`/`service_role` keys fully disabled in Supabase (not just rotated — disabled entirely, since the app had already migrated off the legacy format), `.env` untracked from git with `.env.example` added. No evidence of misuse found. Lesson: never make a repo public with a tracked `.env`, even temporarily — share diffs/snippets instead.

**Migration pipeline drift.** `supabase db push` reported all 14 original migrations as unrecognized due to a systematic few-second offset between filename timestamps and recorded apply-time versions. Root cause confirmed harmless (not corruption). Fixed via careful realignment preserving all stored migration SQL history; verified idempotent with a no-op test migration. `db push` now works cleanly.

---

## 7. Recommended Working Process (proven across the Self-Booking build)

1. **Never accept unverified output** — run it, hit the real route, query the real database. This caught every bug in this document.
2. **Don't stop at the first plausible explanation.** More than once, an initial diagnosis was wrong and only caught because it was pushed to verify further.
3. **Write regression tests for every bug class in Section 4** so they can't silently reappear.
4. **Commit and merge promptly.** Working code left uncommitted or on an unmerged branch is invisible to the running app the moment a branch switch happens.
5. **Spec-first, module-by-module, verify before moving on.**
6. **Payments gets extra paranoia**, more than any module so far: sandbox/test mode only until fully verified, idempotency keys on every payment-writing operation, append-only audit log, extra review pass before touching a real card. Build and ship Phases A → B → C of Section 9 sequentially, never combined into one release, regardless of how much of the spec is already done.
7. **Never let an agent perform an actual authenticated login on your behalf**, even on test accounts.

---

## 8. Roadmap

In priority order:

1. ~~Self-Booking~~ — ✅ done (Section 5)
2. **Payments** — ✅ fully specced (Section 9). **Phase A built and verified against a mock provider; awaiting a Dibsy sandbox account to swap in the real adapter** (see the Phase A swap-in checklist). Phases B and C not started. Build order remains Phase A → B → C, one at a time, each fully verified before the next — and per Section 7 item 6, Phase A should be running against real Dibsy before B begins.
3. **WhatsApp Automation** — not yet specced. Real Twilio/WhatsApp Business API integration, replacing the manual `wa.me` link and the current dev-mode OTP fallback. Natural overlap with Payments Phase B (WhatsApp payment links), worth specing next once Phase A ships.
4. **Memberships, Packages & Gift Cards (client-facing)** — not yet specced. Distinct from the existing internal services/packages pricing catalog.

Lower priority, not yet specced: marketing/email campaigns, payroll & commission tracking, digital consent/intake forms, two-way client texting, native mobile app, deeper BI, inter-location stock transfer, labor-law-aware leave tracking.

---

## 9. Payments — Fully Specced (Phase A built against a mock provider)

**Gateway decision:** **Dibsy** — chosen and confirmed as the single payment provider for the entire product, across all three phases below. Key reasons: Qatar-domiciled entity (Paywise QFC Branch), QCB-licensed, PCI-DSS compliant, accepts Visa/Mastercard/NAPS/QNB cards plus Apple Pay/Google Pay/Himyan, explicitly markets subscription/recurring billing support, and generates shareable payment links (fits the product's WhatsApp-first design). Settlement twice weekly, flat 2.5% + 1 QAR per transaction.

**Important constraint confirmed during research:** Dibsy is online/digital-only — it does **not** support physical card terminals or Tap to Pay/SoftPOS. This was a deliberate scope decision (see Phase B) to stay single-vendor rather than integrate a second payment provider (e.g. SADAD or Tap Payments, both of which do offer terminals + SoftPOS + links under one dashboard) purely to cover those two channels. Terminals/Tap to Pay are **off the roadmap for now** — revisit only if real salon usage shows QR/WhatsApp checkout genuinely isn't sufficient.

**Cross-phase architecture, established in Phase A and reused throughout:**
- **Webhook-as-source-of-truth.** A signature-verified, server-to-server webhook from Dibsy is the *only* thing that ever marks a payment as succeeded. Client-side redirects back from Dibsy's checkout are cosmetic/UX only (a "confirming your payment..." state) — never trusted as proof of payment. This closes off a real payment-bypass vulnerability (spoofed redirect URLs) and is non-negotiable across all phases.
- **Idempotency keys** on every payment-writing operation (per Section 7).
- **Append-only audit log** for every payment/refund event — never mutate a payment record in place.

---

### Phase A — Booking Deposits — 🟡 BUILT, verified against a mock provider

Deposits collected at the point of self-booking (and optionally in-store for walk-ins), to reduce no-shows.

**Status:** every item below (1–10) is implemented and verified end-to-end against a `MockPaymentProvider`, because Dibsy sandbox access requires a registered business that doesn't exist yet. Nothing about Phase A's internal logic depends on the real provider, so it was built and tested first deliberately.

**What "verified against a mock" does and does not mean.** The mock fakes *only the money movement*. It performs real HMAC-SHA256 signing with a replay window, and its developer checkout page posts correctly-signed payloads into the genuine webhook endpoint — so signature verification, idempotency, state transitions, and the audit log are all exercised for real, not stubbed out. What is **not** yet proven is anything specific to Dibsy's actual API shape; see the swap-in checklist below.

**Architecture as built:**
- `PaymentProvider` interface — `createCharge()`, `verifyWebhookSignature()`, `refund()` — in `src/lib/payments/provider.ts`. Adapters normalise their own webhook payloads into a provider-neutral event, so provider-shaped JSON never escapes the adapter boundary.
- `getPaymentProvider()` in `index.server.ts` is the single switch point, keyed off `PAYMENT_PROVIDER`. An unknown value **throws** rather than falling back to the mock — silently using a fake gateway would mean "paid" bookings that never took money.
- The database owns every state transition and all money arithmetic; the Node layer owns only provider I/O. Since the DB cannot call a gateway, `public_cancel_by_token` returns a refund *instruction* which the caller executes and then reports back via `payment_record_refund`.
- The overlap trigger and `public_compute_slots` share a single predicate, `appointment_holds_slot()`. Keeping this in one place is deliberate: two copies drifting apart would mean the trigger rejecting a slot the picker just offered, or a real double-booking.
- Webhook is mounted directly on the fetch handler in `src/server.ts`, not as a route, because signature verification needs the exact raw request bytes.

**Four bugs were found by end-to-end testing that code review had not caught** — two of them generalise beyond payments and are now recorded as Section 4 items 7 and 8. The other two were payments-specific: `staff_request_deposit` couldn't resolve a default amount for exactly the walk-in case it existed to serve, and the append-only audit trigger conflicted with `ON DELETE SET NULL` foreign keys such that no appointment with payment history could ever be deleted (the audit log no longer FK-references the mutable rows it describes).

1. **Deposit configuration:** Owner sets, per service: whether a deposit applies at all, whether it's a **flat QAR amount or a percentage** of the service price (Owner's choice per service, not fixed to one or the other), and whether it's **mandatory or optional**.
2. **Targeting beyond service:** deposit rules can also key off **client type** — specifically, automatically requiring a deposit from **new clients** (no completed appointment history yet), the highest-no-show-risk segment, regardless of which service they're booking.
3. **Optional-and-skipped deposits are visible to staff** — an appointment where the client declined an optional deposit shows a flag/badge (same visual pattern as the existing no-show-count badge), so Receptionists have context without the booking being blocked.
4. **Deposit counts toward the total.** At checkout, staff log only the *remaining* balance — the Appointment Complete income-logging step needs a small update to reflect deposit-already-collected and compute the remainder.
5. **Refund policy: time-based.** Owner-configurable notice cutoff (same mental model as the existing booking min-notice setting) — full refund if cancelled before the cutoff, deposit forfeited if cancelled late or as a no-show.
6. **Refunds are fully automatic** via Dibsy's refund API the moment a qualifying cancellation happens through the existing self-service manage-link flow — no manual approval step, consistent with keeping cancel/reschedule genuinely self-service. Every refund is logged immutably regardless.
7. **In-store deposit collection is also supported** — staff can manually trigger a deposit request for a walk-in or phone-booked appointment, not just through the public booking flow. Same underlying Dibsy mechanism as the public flow.
8. **Slot-holding mechanic:** book-first, not payment-first. The appointment row is created immediately with `deposit_status = 'pending'`, and — critically — **this pending row counts against the existing hard DB overlap trigger right away**, giving a real, reliable hold rather than a UI-only one. A short expiry window applies to the hold.
9. **Expiry handling — check-on-read AND periodic cleanup, not just one:**
   - `public_compute_slots` (and the overlap trigger) must treat expired-but-still-`pending` rows as if they don't exist, so availability is always instantly correct without depending on any background job having run recently.
   - A separate periodic cleanup job actually cancels/removes long-expired pending rows, purely for data hygiene (keeping Reports and the Appointments calendar clean of abandoned payment attempts) — nothing else depends on its timing.
10. **New schema needed:** `deposit_percentage` and/or `deposit_amount` + `deposit_required` (boolean) + a client-type targeting flag on `services`; `deposit_status` enum (`pending`/`paid`/`refunded`/`forfeited`/`expired`) on `appointments`; a payments/transactions table for the actual Dibsy charge + refund records, keyed for idempotency and audit.

---

### Phase A — Dibsy swap-in checklist

Work through this when sandbox access exists. The mock was written against *assumptions* about Dibsy's API; each item below is one of those assumptions, and each is contained within the adapter unless noted. Adding the real provider should be one new file (`dibsy-provider.server.ts`) plus one `case` in `getPaymentProvider()` — if it turns into more than that, something in the abstraction was wrong and is worth fixing rather than working around.

- [ ] **Signature scheme.** The mock uses a Stripe-style `x-mock-signature: t=<unix>,v1=<hmac-sha256>` computed over `` `${timestamp}.${rawBody}` ``, with a 300-second replay window. Dibsy's header name, canonical string, digest, and tolerance will all differ. Verify against the exact raw bytes — re-serialising parsed JSON changes whitespace/key order and breaks the MAC.
- [ ] **Idempotency key ownership.** We generate keys and pass them to the provider. Some gateways ignore client-supplied keys, or expect them in a specific header, or mint their own. If Dibsy generates its own, `payment_open_charge` needs to reconcile both identifiers rather than assuming ours is authoritative.
- [ ] **Refund timing — most likely to need real work.** The mock returns refund success synchronously, so `payment_record_refund` is called inline. Real refunds are usually **asynchronous**: the API returns "accepted" and a webhook confirms later. The `refund.succeeded` / `refund.failed` webhook branches currently only log as informational — they must become authoritative, mirroring how charges already work. Until then a failed async refund would look successful.
- [ ] **Amount units.** Schema and adapter currently use decimal QAR (`numeric(10,2)`). If Dibsy expects minor units (integer dirhams), convert **inside the adapter** — do not change the schema, or every existing money query has to change with it.
- [ ] **Metadata round-trip.** We attach `appointment_id` / `brand_id` metadata and assume it comes back on the webhook. If Dibsy doesn't echo metadata, nothing breaks: confirmation already looks up by `provider_ref`, not metadata. Worth confirming rather than discovering.
- [ ] **`charge.failed` semantics.** We deliberately leave the slot hold alive on failure so the client can retry within the window. Confirm Dibsy has no terminal-failure event that should release the hold immediately instead.
- [ ] **Checkout URL lifetime.** The mock's checkout URL never expires. If Dibsy's hosted checkout links expire, that interacts with `brands.deposit_hold_minutes` — the link should outlive the hold, not the reverse.
- [ ] **Set `PAYMENT_PROVIDER=dibsy`** and replace `MOCK_PAYMENT_WEBHOOK_SECRET` with the real signing secret. Keep the mock adapter in the tree: it stays useful for local development and for testing the failure paths a sandbox won't reproduce on demand.
- [ ] **Re-run the Phase A verification list against the sandbox** before any real card is touched (Section 7, item 6). Passing against the mock proves our logic, not the integration.

---

### Phase B — In-Salon Checkout

Collecting the remaining balance (or full payment for non-deposit bookings) in-salon, digitally.

1. **Channels: QR-code checkout + WhatsApp payment links only.** Both are natively supported by Dibsy and reuse 100% of Phase A's payment infrastructure. Physical terminals and Tap to Pay are explicitly out of scope (see gateway constraint above).
2. **Manual trigger, not automatic.** Staff click a "Request payment" action, separate from marking the appointment "Completed" — decoupling these avoids generating a payment request before the final amount (including any add-ons) is actually settled.
3. **No separate "staff-assisted" code path.** Whether the client scans on their own phone or staff hands them a shared device, it's the exact same Dibsy-hosted checkout link/QR — no additional logic needed to distinguish these cases.
4. **No expiry on the payment request itself.** Since there's no slot to protect at this stage (unlike Phase A), the link/QR stays valid indefinitely. Instead, the appointment carries a clearly visible **"payment requested — awaiting payment"** status so outstanding balances don't silently disappear from view. This status should feed into a future Reports view (outstanding balances).
5. **Manual cash/card-elsewhere logging always stays available**, even with a Dibsy request outstanding — real salon floors need this flexibility. The moment staff manually log the balance as settled another way, the system **automatically cancels/invalidates** any outstanding Dibsy payment request for that same appointment, preventing an accidental double payment later.
6. **Requested amount is editable by staff** before sending (tips, added retail products, manual discounts) — not strictly locked to the calculated remaining balance. Requires a simple adjustment note/reason attached so Reports stay traceable when the charged amount differs from the base service price.
7. **Fully automatic bookkeeping.** The moment the webhook confirms an in-salon payment, the system writes the `income_records` row itself (no manual re-entry) — the existing `payment_method` enum gains a new value for Dibsy-collected payments.

---

### Phase C — Subscription Billing (Owner → Platform)

Automating what's currently fully manual/offline billing for Owners' own subscriptions.

1. **Onboarding stays untouched.** No payment step added to the existing brand → plan → location wizard. Owners get a trial (existing `subscription_status = 'trial'` state), and are only asked for payment details later — either at trial expiry or whenever they choose to upgrade.
2. **Status tracking is automated; enforcement stays manual for now, deliberately.** `subscription_status` updates automatically to reflect billing reality (e.g., flips to an expired/failed state when appropriate), giving Platform Admin accurate visibility — but actually cutting off a brand's access remains a human decision made through Platform Admin, not an automatic lockout. This is intentional given the current relationship-driven, small-pilot-salon stage of the business; revisit once there's real confidence in the billing automation itself.
3. **Failed-charge handling: automatic retry schedule** (e.g., day 1, day 3, day 7 before treating as a genuine failure) — **must be validated against whatever Dibsy's recurring billing product actually offers natively before building a custom retry scheme.** Don't reinvent dunning logic if Dibsy already handles it.
4. **Plan changes are not prorated.** Upgrading or downgrading mid-cycle applies the new plan's location/staff limits **immediately**, but billing simply catches up at the next normal renewal date — no proration math. Deliberately simple, matching the trust-based way billing has been run manually so far, and avoiding a notoriously bug-prone area of subscription billing systems.
5. **New schema needed:** a saved payment method reference per brand (tokenized via Dibsy, never storing raw card data), a billing/invoice history table, and fields to track retry attempts and next-retry timestamps on failed charges.

---

*Update this file after each new feature is specced or shipped.*
