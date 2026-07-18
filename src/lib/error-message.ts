// Supabase/PostgREST errors are plain objects with a `message` field, not
// Error instances. `err instanceof Error ? err.message : fallback` silently
// swallows those. Use this helper to surface the real message.
export function errorMessage(err: unknown, fallback?: string): string | undefined {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
