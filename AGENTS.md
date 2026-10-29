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
  sveltekit-adapter-demino.ts      — adapter + generateHandler() template
  deno-imports.ts                  — deno-imports.json emission (SSR bundle scanner)
tests/
  sveltekit-adapter-demino.test.ts — adapter tests (incl. a runtime test of handler.js)
  deno-imports.test.ts             — scanner / emission tests
scripts/
  build-npm.ts                     — npm build via @marianmeres/npmbuild
example/
  server.ts                        — example server: demino + handler, `serve` from @marianmeres/demino/deno
  deno.json                        — Deno config with SvelteKit import mappings
  sveltekit-app/                   — bare-bones SvelteKit app wired to this adapter
    svelte.config.js               — uses @marianmeres/sveltekit-adapter-demino
    package.json                   — adapter linked via file:../../.npm-dist
```

## What This Package Does

SvelteKit adapter that produces a `(req, info) => Response` `handler.js` at build time,
for `@marianmeres/demino` 2.0 on Deno or Node.

**Two execution contexts:**
1. **Build time** (Node/Vite) — the adapter code itself (`src/`). Uses `node:fs`,
   `@sveltejs/kit` Builder API. Runs inside `vite build`.
2. **Serve time** (Deno or Node) — the *generated* `handler.js`. Uses web standards,
   `node:*` built-ins, `serveStatic` from `@marianmeres/demino`, SvelteKit's `Server`
   class. Runs under `serve` from `@marianmeres/demino/deno` or `/node` (or any
   `(req, info) => Response` host). `info` is demino's `DeminoServeInfo`.

**Runtime contract:** the consumer's app provides `@marianmeres/demino` ≥ 2.0 (Deno:
`deno.json` `imports`; Node: `node_modules`). `deno-imports.json` never maps it
(`SKIPPED_PACKAGES` in `src/deno-imports.ts`) — an `npm:` mapping would load a second
demino into a Deno app.

The generated handler:
1. Handles prerendered trailing-slash redirects (308)
2. Serves static assets + prerendered HTML via demino's `serveStatic` (404/405 → SSR)
3. Sets `Cache-Control` headers on all disk-served responses based on three categories:
   - `/_app/immutable/*` → `public, immutable, max-age=31536000`
   - Prerendered pages (set embedded at build time from `builder.prerendered.pages`) → `public, max-age=600, stale-while-revalidate=86400`
   - Unhashed static files (everything else from `static/`) → `public, max-age=86400`
4. Falls through to SvelteKit SSR via `server.respond()`
5. Provides `read()` to SvelteKit for `$app/server` asset access

## Key Types

```ts
interface CacheControlOptions {
  immutable?: string | false;   // default: "public, immutable, max-age=31536000"
  prerendered?: string | false; // default: "public, max-age=600, stale-while-revalidate=86400"
  assets?: string | false;      // default: "public, max-age=86400"
}

interface AdapterOptions {
  out?: string;                  // default: "build"
  cacheControl?: CacheControlOptions;
  denoImports?: boolean | DenoImportsOptions; // default: true (emit build/deno-imports.json)
}

interface DenoImportsOptions {
  enabled?: boolean;                             // default: true
  versionPrefix?: "caret" | "exact" | "tilde";   // default: "caret"
  extraSpecifiers?: string[];
  exclude?: string[];
}

const CACHE_DEFAULTS: Required<CacheControlOptions>  // exported, contains all defaults

function adapter(options?: AdapterOptions): Adapter
```

## Critical Conventions

1. **SSR caching is NOT the adapter's concern.** The adapter only sets `Cache-Control`
   on disk-served static responses (via `serveStatic`'s `headers`). SSR responses pass through
   `server.respond()` unchanged — use SvelteKit's `handle` hook for those.
2. `mod.ts` must `export { default }` AND `export *` — `export *` alone does not
   re-export the default export.
3. The `generateHandler()` function returns a **string template** — it is NOT
   executable code in this package. It gets written to `handler.js` in the build output.
4. The string template must stay runtime-portable: `node:*`, web standards and
   `@marianmeres/demino` only — no `Deno.*` or `jsr:` (a test asserts both), no `npm:`
   specifiers. The adapter source itself never imports demino.
5. `@sveltejs/kit` is a **peer dependency** for npm, mapped via `deno.json` imports
   for Deno.
6. Build-time deps (`@types/node`, `@sveltejs/kit`) are installed by `npmbuild`
   during `npm:build` — they are NOT runtime deps.

## Build Output Structure

When a consumer runs `vite build`, the adapter produces:
```
{out}/
  handler.js         — entry point (import in the demino server)
  client/            — static assets + prerendered pages
  server/            — SvelteKit SSR runtime
  deno-imports.json  — import map entries for the SSR bundle's npm packages (Deno)
```

## Consumer's Server Requirements

- **Node**: `@marianmeres/demino` ≥ 2.0 and SvelteKit's packages in `node_modules`.
- **Deno**: `deno.json` `imports` maps `@marianmeres/demino` itself plus SvelteKit's npm
  imports (merge `build/deno-imports.json`'s `imports`; `"importMap"` alone is not
  enough — Deno ignores it once `imports` exists, and the file never maps demino):
```json
{
  "imports": {
    "@marianmeres/demino": "jsr:@marianmeres/demino@^2",
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

# 4. Run the example server (Deno, `serve` from @marianmeres/demino/deno)
cd .. && deno run -A server.ts

# 5. Verify:
#    http://localhost:9999/         → SvelteKit page
#    http://localhost:9999/api/hello → {"hello":"world"}
```

## Before Making Changes

- Check that `generateHandler()` output stays runtime-portable (Deno and Node)
- Run `deno test`
- Run `deno task npm:build` to verify tsc compilation succeeds
- Test end-to-end: rebuild npm → reinstall in example → `pnpm build` → run server
