# @marianmeres/sveltekit-adapter-demino — Agent Guide

## Quick Reference
- **Stack**: Deno, TypeScript, SvelteKit Adapter API
- **Test**: `deno test` | **Build npm**: `deno task npm:build`
- **Publish**: `deno task rp` (patch) | `deno task rpm` (minor)
- **Format**: tabs, 90 char line width, 4 indent (`deno fmt`)

## Project Structure
```
src/
  mod.ts                           — barrel export (re-exports default + named)
  sveltekit-adapter-demino.ts      — adapter implementation (single file)
tests/
  sveltekit-adapter-demino.test.ts — tests
scripts/
  build-npm.ts                     — npm build via @marianmeres/npmbuild
example/
  server.ts                        — example Deno server using demino + handler
  deno.json                        — Deno config with SvelteKit import mappings
  sveltekit-app/                   — bare-bones SvelteKit app wired to this adapter
    svelte.config.js               — uses @marianmeres/sveltekit-adapter-demino
    package.json                   — adapter linked via file:../../.npm-dist
```

## What This Package Does

SvelteKit adapter that produces a Deno-compatible `handler.js` at build time.

**Two execution contexts:**
1. **Build time** (Node/Vite) — the adapter code itself (`src/`). Uses `node:fs`,
   `@sveltejs/kit` Builder API. Runs inside `vite build`.
2. **Serve time** (Deno) — the *generated* `handler.js`. Uses `jsr:@std/http`,
   `jsr:@std/path`, SvelteKit's `Server` class. Runs inside `Deno.serve()`.

The generated handler:
1. Handles prerendered trailing-slash redirects (308)
2. Serves static assets + prerendered HTML via `serveDir`
3. Sets `Cache-Control: public, immutable, max-age=31536000` for `/_app/immutable/*`
4. Falls through to SvelteKit SSR via `server.respond()`
5. Provides `read()` to SvelteKit for `$app/server` asset access

## Key Types

```ts
interface AdapterOptions { out?: string }  // default: "build"
function adapter(options?: AdapterOptions): Adapter
```

## Critical Conventions

1. `mod.ts` must `export { default }` AND `export *` — `export *` alone does not
   re-export the default export.
2. The `generateHandler()` function returns a **string template** — it is NOT
   executable code in this package. It gets written to `handler.js` in the build output.
3. The string template uses `jsr:` specifiers (Deno runtime), while the adapter
   source uses `node:` and npm imports (Node/Vite build time).
4. `@sveltejs/kit` is a **peer dependency** for npm, mapped via `deno.json` imports
   for Deno.
5. Build-time deps (`@types/node`, `@sveltejs/kit`) are installed by `npmbuild`
   during `npm:build` — they are NOT runtime deps.

## Build Output Structure

When a consumer runs `vite build`, the adapter produces:
```
{out}/
  handler.js   — entry point (import in Deno server)
  client/      — static assets + prerendered pages
  server/      — SvelteKit SSR runtime
```

## Consumer's Deno Server Requirements

The consumer's `deno.json` must map SvelteKit's npm imports:
```json
{
  "imports": {
    "@sveltejs/kit": "npm:@sveltejs/kit@^2.0.0",
    "@sveltejs/kit/internal": "npm:@sveltejs/kit/internal",
    "@sveltejs/kit/internal/server": "npm:@sveltejs/kit/internal/server"
  }
}
```

## Example: Build & Test Flow

```bash
# 1. Build the adapter as npm package (from project root)
deno task npm:build

# 2. Install deps in example SvelteKit app
cd example/sveltekit-app && pnpm install

# 3. Build the SvelteKit app (generates build/handler.js)
pnpm build

# 4. Run the Deno server
cd .. && deno run -A server.ts

# 5. Verify:
#    http://localhost:9999/         → SvelteKit page
#    http://localhost:9999/api/hello → {"hello":"world"}
```

## Before Making Changes

- Check that `generateHandler()` output remains valid Deno code
- Run `deno test`
- Run `deno task npm:build` to verify tsc compilation succeeds
- Test end-to-end: rebuild npm → reinstall in example → `pnpm build` → run server
