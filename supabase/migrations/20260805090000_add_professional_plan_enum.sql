-- Adds 'professional' to the subscription_plan enum.
--
-- THIS MIGRATION DELIBERATELY DOES NOTHING ELSE.
--
-- Postgres refuses to *use* a new enum value in the same transaction that
-- added it ("unsafe use of new value of enum type"), and Supabase runs each
-- migration file in one transaction. So anything that references
-- 'professional' — a backfill, a CHECK, a default — has to live in a later
-- file. Merging this into the schema migration beside it would fail on first
-- apply, and would fail in a way that looks like a typo rather than a
-- transaction-visibility rule.
--
-- ADD VALUE is additive only: it appends a label to the type and never
-- rewrites existing rows, so no brand's stored plan can change as a result of
-- this. AFTER 'growth' places it correctly in sort order, which matters
-- because enum comparisons order by definition order, not alphabetically.
--
-- IF NOT EXISTS keeps it idempotent against a partially-applied history.

ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'professional' AFTER 'growth';
