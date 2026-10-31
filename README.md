# @marianmeres/sveltekit-adapter-demino

[![NPM](https://img.shields.io/npm/v/@marianmeres/sveltekit-adapter-demino)](https://www.npmjs.com/package/@marianmeres/sveltekit-adapter-demino)
[![License](https://img.shields.io/npm/l/@marianmeres/sveltekit-adapter-demino)](LICENSE)

A SvelteKit adapter that outputs a Web-standard `(req, info) => Response` handler
for [`@marianmeres/demino`](https://www.npmjs.com/package/@marianmeres/demino) 2.0
on Node or Deno. Mount it in a demino app and serve it through the demino adapter of
your runtime (`@marianmeres/demino/node` or `@marianmeres/demino/deno`).

> **Requires `@marianmeres/demino` ≥ 2.0 at runtime.** The generated handler
> imports `serveStatic` from it; your server app provides it.

## Install

Install the adapter as an npm dev dependency in your SvelteKit project:

```bash
npm install -D @marianmeres/sveltekit-adapter-demino
```

> The adapter runs at **build time** inside Vite/Node.js. It is not installed via
> `deno add` — your Deno or Node server only runs the _generated_ `handler.js`.

## Configure

```js
// svelte.config.js
import adapter from "@marianmeres/sveltekit-adapter-demino";

export default {
	kit: {
		adapter: adapter({
			out: "build", // default
			// Cache-Control headers for disk-served static responses.
			// All values below are defaults — override or set to `false` to disable.
			cacheControl: {
				immutable: "public, immutable, max-age=31536000", // /_app/immutable/*
				prerendered: "public, max-age=600, stale-while-revalidate=86400", // prerendered pages
				assets: "public, max-age=86400", // unhashed static files
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
├── handler.js         <- import this in your demino server
├── client/            <- static assets + prerendered HTML (served automatically)
├── server/            <- SvelteKit SSR runtime (used internally by handler.js)
└── deno-imports.json  <- import map entries for Deno (see Notes)
```

## Usage in your server

On Node (`npm install @marianmeres/demino`):

```ts
import { demino, deminoCompose } from "@marianmeres/demino";
import { serve } from "@marianmeres/demino/node";
import { handler as skHandler } from "./build/handler.js";

const api = demino("/api");
api.get("/hello", () => ({ hello: "world" }));

// SvelteKit handles everything that the API doesn't
const sk = demino();
sk.all("/*", skHandler);

await serve(deminoCompose([api, sk]), { port: 8000 });
```

On Deno, the same code with the Deno adapter:

```ts
import { demino, deminoCompose } from "@marianmeres/demino";
import { serve } from "@marianmeres/demino/deno";
import { handler as skHandler } from "./build/handler.js";

// ... same apps as above
await serve(deminoCompose([api, sk]), { port: 8000 });
```

`@marianmeres/demino` is a bare specifier here and in `handler.js`, so your
`deno.json` maps it (e.g. `"@marianmeres/demino": "jsr:@marianmeres/demino@^2"`).

Or if SvelteKit is your only app:

```ts
import { serve } from "@marianmeres/demino/node"; // or '@marianmeres/demino/deno'
import { handler } from "./build/handler.js";

await serve(handler);
```

## How it works

The generated `handler.js`:

1. **Prerendered redirects** -- handles trailing-slash normalization (308 redirects)
   for prerendered pages, based on your SvelteKit `trailingSlash` config.

2. **Static files & prerendered HTML** -- served from `build/client/` with
   demino's `serveStatic` (ETag/304, Range, `HEAD`; dotfiles are not served).
   This covers everything in your `static/` folder, compiled JS/CSS
   (`/_app/...`), and prerendered pages. A miss (404/405) falls through to SSR.
   Each hit (200/206/304) gets a `Cache-Control` header based on its category:

   | Category      | Path pattern                              | Default header                                      |
   | ------------- | ----------------------------------------- | --------------------------------------------------- |
   | Immutable     | `/_app/immutable/*`                       | `public, immutable, max-age=31536000`               |
   | Prerendered   | Pages from SvelteKit's prerender list     | `public, max-age=600, stale-while-revalidate=86400` |
   | Static assets | Everything else (favicon, fonts, images…) | `public, max-age=86400`                             |

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
  `{ info: DeminoServeInfo }` (from `@marianmeres/demino`), giving you access to
  `remoteAddr` etc. — whatever the runtime adapter provides.
- The adapter runs in Node.js at build time (it's a Vite plugin). The
  generated `handler.js` uses only web standards, `node:*` built-ins and
  `@marianmeres/demino`, so it runs on Node or Deno at serve time.
- On Node, every package the handler and SvelteKit's SSR bundle import resolves
  from your `node_modules`; nothing else is needed.
- On Deno, your server needs an import map for the npm packages that SvelteKit's
  SSR bundle references at runtime. The adapter emits `build/deno-imports.json`
  listing every bare specifier it found, each pinned to the version installed
  in your `node_modules`. Copy its `imports` block into your `deno.json`
  `imports`, next to your own `@marianmeres/demino` entry:

  ```jsonc
  // deno.json
  {
    "imports": {
      "@marianmeres/demino": "jsr:@marianmeres/demino@^2",
      // ...the entries from build/deno-imports.json
    }
  }
  ```

  `deno-imports.json` never maps `@marianmeres/demino` — your app's import map
  (or `package.json`) provides it, and an `npm:` mapping would load a second
  demino next to your app's own. So pointing `"importMap"` at the generated
  file alone is not enough: the handler's `@marianmeres/demino` import would
  not resolve (and Deno ignores `"importMap"` once `"imports"` is present).
  The file is regenerated on every build and keys are sorted alphabetically,
  so diffs stay clean.

  Disable emission with `adapter({ denoImports: false })`, or refine via
  `adapter({ denoImports: { versionPrefix: "exact", exclude: ["tailwind-merge"], extraSpecifiers: ["some-dynamic-pkg"] } })`.

  Caveats:
  - Dynamic `import(someVar)` with a computed string is invisible to any
    static scanner — use `extraSpecifiers` to force-add those entries.
  - A package whose `exports` doesn't list a subpath the SSR bundle actually
    imports will still error at runtime; no import map can work around that.

  Minimal manual fallback if you skip the generated file entirely:

  ```json
  {
    "imports": {
      "@marianmeres/demino": "jsr:@marianmeres/demino@^2",
      "@sveltejs/kit": "npm:@sveltejs/kit@^2.0.0"
    }
  }
  ```

## Breaking changes (2.0.0)

The generated `handler.js` no longer depends on Deno: it serves static files with
`serveStatic` from `@marianmeres/demino` and uses `node:*` built-ins instead of
`Deno.*` and `jsr:@std/*`, so it runs on Deno or Node. The adapter's own options
and exports are unchanged.

- **Your server app must provide `@marianmeres/demino` ≥ 2.0.** demino 1.x has no
  `serveStatic`, so `handler.js` fails to load against it; a server that ran the
  handler on plain `Deno.serve()` without demino now needs it as well. Deno: add
  `"@marianmeres/demino": "jsr:@marianmeres/demino@^2"` to your `deno.json`
  `imports`. Node: `npm install @marianmeres/demino`. Upgrading demino itself is
  covered by its
  [migration guide](https://github.com/marianmeres/demino/blob/master/docs/MIGRATION-2.0.md).
- **`"importMap": "./build/deno-imports.json"` no longer works on its own.** The
  file never maps `@marianmeres/demino`, and Deno ignores `"importMap"` once
  `"imports"` exists. Copy its entries into your `deno.json` `imports` instead
  (see [Notes](#notes)).
- **`platform.info` is typed `DeminoServeInfo`.** Under `serve` from
  `@marianmeres/demino/deno` it is `{ remoteAddr, upgradeWebSocket, raw }`;
  Deno's own `ServeHandlerInfo` is on `raw`, so code reading other Deno fields
  (e.g. `platform.info.completed`) reads them from `platform.info.raw`.

## License

[MIT](LICENSE)
