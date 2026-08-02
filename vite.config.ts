// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target — overridden to vercel below),
//     VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },

  // Deployment target: Vercel.
  //
  // Pinned explicitly rather than left to Nitro's platform auto-detection.
  // Auto-detection does work — Nitro reads VERCEL=1 during a Vercel build and
  // selects this preset on its own — but the preset library above defaults to
  // `cloudflare-module` when nothing is detected, so a local `npm run build`
  // was producing Cloudflare Worker output (`wrangler.json`, `.wrangler/`) for
  // an app that deploys to Vercel. That is a confusing thing to hand the next
  // person reading this repo, and it means a local build never exercises the
  // artifact production actually runs.
  //
  // With this pin, `npm run build` emits `.vercel/output` (Build Output API
  // v3) everywhere — locally and in CI — so what is tested is what ships.
  //
  // Lovable's own sandbox builds force Cloudflare regardless of this setting,
  // by design, so the in-Lovable preview is unaffected.
  //
  // If the deployment target ever changes, this line is the single place to
  // change it.
  nitro: { preset: "vercel" },
});
