-- No-op migration. Sole purpose: verify `supabase db push` works end-to-end
-- after realigning schema_migrations.version with local migration filenames.
-- Intentionally changes nothing.
DO $$ BEGIN NULL; END $$;
