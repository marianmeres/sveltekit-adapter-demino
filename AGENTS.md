# @marianmeres/sveltekit-adapter-demino — Agent Guide

## Quick Reference

- **Stack**: TypeScript on Node (dev runtime, reference, CI gate), SvelteKit Adapter API,
  pnpm, Biome. Published to npm only (no JSR). Deno is a _consumer_ runtime of the
  generated `handler.js`, not a dev runtime.
- **Install**: `pnpm install` | **Test**: `pnpm test` (`node:test`; `pnpm run test:deno`
  runs the same suite on Deno) | **Build**: `pnpm run build` (`tsc` → `dist/`)
- **Gate**: `pnpm run ci` (tsc `--noEmit` + Biome + tests + npm smoke)
- **Publish**: `pnpm run rp` (patch) | `pnpm run rpm` (minor) — npm only
- **Format**: `pnpm run format` (Biome: tabs, 90 char line width, double quotes)

## Project Structure
```
src/
  mod.ts                           — barrel export (re-exports default + named)
  sveltekit-adapter-demino.ts      — adapter + generateHandler() template
  deno-imports.ts                  — deno-imports.json emission (SSR bundle scanner)
tests/                             — node:test + node:assert; runs on Node and on Deno
  sveltekit-adapter-demino.test.ts — adapter tests (incl. a runtime test of handler.js)
  deno-imports.test.ts             — scanner / emission tests
scripts/
  smoke-npm.mjs                    — packs, installs and exercises the npm tarball
example/
  server.ts                        — example server: demino + handler, `serve` from @marianmeres/demino/node
  sveltekit-app/                   — bare-bones SvelteKit app wired to this adapter
    svelte.config.js               — uses @marianmeres/sveltekit-adapter-demino
    package.json                   — adapter linked via link:../.. (repo root → dist/)
package.json                       — manifest of record: version, scripts, exports → dist/
tsconfig.json                      — type gate (src + tests); tsconfig.build.json emits src → dist
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
5. `@sveltejs/kit` is a **peer dependency**; the adapter imports only its types, so the
   package has no runtime dependencies. `@marianmeres/demino` is a dev dependency only
   (the runtime test and the example import it; the adapter source never does).
6. Erasable-only TS (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `import type`,
   explicit `.ts` extensions): Node runs `src/` and `tests/` type-stripped and never
   type-checks, so `pnpm run typecheck` is the only type gate. No `Deno.*` / `Bun.*`
   calls and no `jsr:` / `npm:` specifiers in the repo's own code.

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
# 1. Build the adapter (dist/), then install + build the example SvelteKit app
#    (example-build.sh). The app links the repo root, so a later adapter rebuild
#    (`pnpm run build`) needs no reinstall — only `pnpm build` in the app.
pnpm run example:build

# 2. Run the example server (Node, `serve` from @marianmeres/demino/node)
pnpm run example

# 3. Verify:
#    http://localhost:9999/         → SvelteKit page
#    http://localhost:9999/api/hello → {"hello":"world"}
```

## Before Making Changes

- Check that `generateHandler()` output stays runtime-portable (Deno and Node)
- Run `pnpm run ci` (typecheck, Biome, tests, npm smoke)
- Changed the generated handler? Also `pnpm run test:deno` (Deno-served apps run it)
- Test end-to-end: `pnpm run example:build` → `pnpm run example`
