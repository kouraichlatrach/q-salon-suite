
# Self-Booking Portal — Implementation Plan

A large, multi-part feature. Grouped into 5 phases; every DB change ships in phase 1 so the rest is pure app code.

---

## Prerequisite decision: SMS provider

The OTP + confirmation SMS flow needs a real sender. Recommend **Twilio** via the Lovable connector (managed auth, no keys in code). Before I start, please:

1. Open **Connectors → Twilio** and link a connection.
2. Confirm a Twilio phone number (E.164) I should use as the `From` sender — I'll store it as a brand-level `sms_sender` column so each brand can override later, defaulting to a `TWILIO_FROM_NUMBER` secret.

If you'd rather use GatewayAPI, WhatsApp Business, or skip SMS in v1 (dev-mode: OTP shown on screen / logged), tell me and I'll swap the adapter — the rest of the code is provider-agnostic behind one `sendSms(to, body)` helper.

---

## Phase 1 — Schema & RLS (single migration)

**New tables**
- `staff_services` — `(user_id, service_id, brand_id)`, unique on `(user_id, service_id)`. RLS: brand owners full access; managers can manage rows for staff whose `user_roles.location_id` matches a location they manage; staff can read their own rows. Public anon can `SELECT` (needed by booking flow) — safe because it's just capability metadata.
- `booking_tokens` — `(token text pk, appointment_id fk, expires_at timestamptz, created_at)`. Random 32-char url-safe token. RLS: no direct anon read; access only through a security-definer RPC that returns the appointment by token.
- `booking_otps` — `(id, phone, brand_id, code_hash, expires_at, attempts int, consumed_at)`. Anon can `INSERT` (rate-limited in app) and the verify RPC reads it as security-definer. Codes stored hashed.

**Column additions**
- `brands.slug text unique not null` — auto-generated from name (slugified + suffix on collision). Backfill for existing rows.
- `brands.min_notice_hours int not null default 3`
- `brands.max_advance_days int not null default 30`
- `brands.sms_sender text` — optional per-brand override for Twilio `From`.

**Functions / RPCs (all `security definer`, `search_path=public`)**
- `public_get_brand_by_slug(slug)` → brand + locations + settings (safe columns only).
- `public_list_services(brand_id, location_id)` → services active at that location with effective price.
- `public_list_staff_for_service(location_id, service_id)` → qualified staff (id + display name).
- `public_compute_slots(location_id, service_id, staff_user_id?, date_from, date_to)` → array of `{start, end, staff_user_id}` computed from `staff_schedules` − `staff_leave` − existing `appointments`, clipped by `min_notice_hours`/`max_advance_days`.
- `public_start_otp(phone, brand_id)` → creates row, returns id + plaintext code to the caller **only when called from a trusted server function** (we gate this by requiring a server-signed nonce; simplest: keep the RPC private and generate/store the code inside a TanStack server function using `supabaseAdmin`, then send via Twilio).
- `public_verify_otp_and_book(...)` → verifies code, upserts client by phone within brand, inserts appointment (relies on existing `prevent_appointment_overlap` trigger), returns `{appointment_id, manage_token}`. Catches unique/overlap error and returns a typed `{error:'slot_taken'}` result.
- `public_get_appointment_by_token(token)`, `public_cancel_by_token(token)`, `public_reschedule_by_token(token, new_starts_at, staff_user_id)`.
- `public_list_appointments_by_phone(brand_id, phone)` — called only after OTP verification inside a server fn.

**GRANTs** — new tables get `GRANT` to `authenticated` + `service_role`; `staff_services` also gets `SELECT` to `anon`. OTP/token tables get no direct anon grants; access is via `SECURITY DEFINER` RPCs, called from server functions using the service-role client after signature checks.

---

## Phase 2 — Internal UI additions

- **Staff module**: new "Services performed" panel on each staff row (multi-select of brand services, gated by Owner or the Manager of that staff's location). Uses `staff_services`.
- **Settings page**: two new number inputs — "Minimum notice (hours)" and "Booking window (days ahead)". Owner-only. Also a read-only "Public booking link" showing `/book/{slug}` with copy button.

---

## Phase 3 — Public booking flow (`/book/$brandSlug`)

New public route tree under `src/routes/book.$brandSlug.*.tsx` (top-level, not under `_authenticated`). SSR on so links preview well; each step is its own route so back-button works.

- `book.$brandSlug.index.tsx` — location picker (auto-skip if 1 location; honors `?location=`).
- `book.$brandSlug.$locationId.services.tsx` — service grid with price + duration.
- `book.$brandSlug.$locationId.$serviceId.staff.tsx` — qualified staff cards + "No preference".
- `book.$brandSlug.$locationId.$serviceId.$staff.time.tsx` — day picker + slot list (calls `public_compute_slots` via server fn).
- `book.$brandSlug....confirm.tsx` — name + phone → OTP → verify → book. On `slot_taken`, auto-refetches next 10 slots without dumping the user.
- `book.$brandSlug....done.tsx` — confirmation with details, manage link, SMS-sent notice.
- `book.$brandSlug.lookup.tsx` — phone → OTP → list of upcoming appointments with manage links.

All server work goes through `createServerFn` (public, no `requireSupabaseAuth`) that call the `SECURITY DEFINER` RPCs and Twilio helper. Public read-only queries use the publishable-key server client.

Head metadata: unique title/description per brand, `og:title/description` from brand name.

---

## Phase 4 — Manage page (`/manage/$token`)

- Server fn `public_get_appointment_by_token(token)` — 404 if invalid, expired, or appointment already past/cancelled.
- Actions: **Cancel** (RPC) and **Reschedule** (reuses slot picker + `public_reschedule_by_token`).
- Token invalidated (row deleted or `expires_at` set to now) when appointment is cancelled or its `ends_at` passes.

---

## Phase 5 — SMS adapter + design polish

- `src/lib/sms.server.ts` — one `sendSms({to, body})` fn that reads Twilio connector env vars and posts to the connector gateway. If no connector linked yet, falls back to `console.log` in dev and throws a clear error in prod.
- Public routes share a new lightweight `<BookingShell>` layout: warm cream background, rose-gold accents, Cormorant headings, generous whitespace, single-column mobile-first, progress indicator across steps. Distinct from the admin `AppShell` — no sidebar, salon-name header only.

---

## Technical notes (for the technical reader)

- Availability engine runs entirely in Postgres for a single round-trip — generates candidate slot starts on a `generate_series` at the service's duration granularity, then anti-joins against `appointments` (status ≠ cancelled) and `staff_leave`, and inner-joins to `staff_schedules` weekday windows.
- OTP: 6-digit numeric, hashed with `crypt(code, gen_salt('bf'))`, 10-min expiry, max 5 verify attempts, max 3 sends per phone per 15 min (enforced in the server fn using `booking_otps` history).
- Token: `encode(gen_random_bytes(24), 'base64url')`, 32 chars, unique index.
- Overlap race: `public_verify_otp_and_book` runs the insert inside `BEGIN; ... EXCEPTION WHEN check_violation THEN RETURN slot_taken; END;`.
- Slug backfill for existing brands uses `regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')` with numeric suffix on collision.

---

## Out of scope (as specified)

- Payments / deposits.
- Automated WhatsApp reminders beyond the existing manual `wa.me` link.

---

**To proceed I need:** confirmation on Twilio (or an alternative SMS provider / dev-mode). Once you approve this plan and pick the SMS path, I'll ship phase 1 (migration) first, then the rest in follow-up turns since it's a large surface.
