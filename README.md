# @marianmeres/sveltekit-adapter-demino

[![NPM](https://img.shields.io/npm/v/@marianmeres/sveltekit-adapter-demino)](https://www.npmjs.com/package/@marianmeres/sveltekit-adapter-demino)
[![JSR](https://jsr.io/badges/@marianmeres/sveltekit-adapter-demino)](https://jsr.io/@marianmeres/sveltekit-adapter-demino)
[![License](https://img.shields.io/npm/l/@marianmeres/sveltekit-adapter-demino)](LICENSE)

A SvelteKit adapter that outputs a Web-standard `handler(req, info)` function
compatible with [`@marianmeres/demino`](https://jsr.io/@marianmeres/demino) and
any `Deno.ServeHandler`-based server.

## Install

Install the adapter as an npm dev dependency in your SvelteKit project:

```bash
npm install -D @marianmeres/sveltekit-adapter-demino
```

> The adapter runs at **build time** inside Vite/Node.js. It is not installed via
> `deno add` — Deno only runs the *generated* `handler.js` at serve time.

## Configure

```js
// svelte.config.js
import adapter from '@marianmeres/sveltekit-adapter-demino';

export default {
  kit: {
    adapter: adapter({
      out: 'build', // default
      // Cache-Control headers for disk-served static responses.
      // All values below are defaults — override or set to `false` to disable.
      cacheControl: {
        immutable:   'public, immutable, max-age=31536000',          // /_app/immutable/*
        prerendered: 'public, max-age=600, stale-while-revalidate=86400', // prerendered pages
        assets:      'public, max-age=86400',                        // unhashed static files
      },
    }),
  },
};
```

> **Note:** SSR responses are not affected by these settings — use SvelteKit's
> `handle` hook in `hooks.server.ts` to control caching for server-rendered routes.

## Build

```bash
vite build
```

Output structure:

```
build/
├── handler.js      <- import this in your Deno server
├── client/         <- static assets + prerendered HTML (served automatically)
└── server/         <- SvelteKit SSR runtime (used internally by handler.js)
```

## Usage in your Deno server

```ts
import { demino, deminoCompose } from 'jsr:@marianmeres/demino';
import { handler as skHandler } from './build/handler.js';

const api = demino('/api');
api.get('/hello', () => ({ hello: 'world' }));

// SvelteKit handles everything that the API doesn't
const sk = demino();
sk.all('/*', skHandler);

Deno.serve(deminoCompose([api, sk]));
```

Or if SvelteKit is your only app:

```ts
import { handler } from './build/handler.js';
Deno.serve(handler);
```

## How it works

The generated `handler.js`:

1. **Prerendered redirects** -- handles trailing-slash normalization (308 redirects)
   for prerendered pages, based on your SvelteKit `trailingSlash` config.

2. **Static files & prerendered HTML** -- served from `build/client/` using
   `@std/http/file-server`'s `serveDir`. This covers everything in your
   `static/` folder, compiled JS/CSS (`/_app/...`), and prerendered pages.
   Each response gets a `Cache-Control` header based on its category:

   | Category | Path pattern | Default header |
   |----------|-------------|----------------|
   | Immutable | `/_app/immutable/*` | `public, immutable, max-age=31536000` |
   | Prerendered | Pages from SvelteKit's prerender list | `public, max-age=600, stale-while-revalidate=86400` |
   | Static assets | Everything else (favicon, fonts, images…) | `public, max-age=86400` |

   Override any value via `cacheControl` in adapter options, or set to `false`
   to skip setting the header for that category.

3. **Everything else** -- forwarded to SvelteKit's SSR engine via
   `server.respond()`. This handles server routes, SSR pages, and API
   endpoints defined inside your SvelteKit app.

4. **Asset reading** -- the handler provides a `read()` function to
   SvelteKit's server, enabling `import { read } from '$app/server'`
   for runtime asset access.

## Notes

- Deno permissions needed at runtime: `--allow-net`, `--allow-read`, `--allow-env`
- The `platform` object available in SvelteKit hooks/endpoints will contain
  `{ info: Deno.ServeHandlerInfo }`, giving you access to `remoteAddr` etc.
- The adapter runs in Node.js at build time (it's a Vite plugin). The
  generated `handler.js` runs in Deno at serve time.
- Your Deno server needs an import map for the npm packages that SvelteKit's
  SSR bundle references at runtime. The adapter emits `build/deno-imports.json`
  listing every bare specifier it found, each pinned to the version installed
  in your `node_modules`. Point your `deno.json` at it:
  ```jsonc
  // deno.json
  {
    "importMap": "./build/deno-imports.json"
  }
  ```
  Or copy its `imports` block into your existing `deno.json` `imports`. The
  file is regenerated on every build and keys are sorted alphabetically, so
  diffs stay clean.

  Disable emission with `adapter({ denoImports: false })`, or refine via
  `adapter({ denoImports: { versionPrefix: "exact", exclude: ["tailwind-merge"], extraSpecifiers: ["some-dynamic-pkg"] } })`.

  Caveats:
  - Dynamic `import(someVar)` with a computed string is invisible to any
    static scanner — use `extraSpecifiers` to force-add those entries.
  - A package whose `exports` doesn't list a subpath the SSR bundle actually
    imports will still error at runtime; no import map can work around that.

  Minimal manual fallback if you skip the generated file entirely:
  ```json
  { "imports": { "@sveltejs/kit": "npm:@sveltejs/kit@^2.0.0" } }
  ```

## License

[MIT](LICENSE)
