// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    // Build a plain Node server, NOT the scaffold's default `cloudflare-module`.
    //
    // This app cannot run on Cloudflare Workers: the database is a real file
    // (data/app.db, via node:sqlite) and uploaded photos are real files under
    // data/uploads/. Workers have neither a filesystem nor node:sqlite, so a
    // Cloudflare build would fail at runtime rather than at build time — the
    // worst place to find out.
    //
    // `node-server` emits .output/server/index.mjs, started with
    // `node .output/server/index.mjs`. Deploy to a host with a persistent
    // disk mounted at data/ (Railway/Render/Fly/a VPS).
    //
    // Nitro's own auto-detection (NITRO_PRESET, or Vercel/Netlify env vars)
    // still overrides this, so don't build from inside one of those CIs.
    preset: "node-server",
  },
});
