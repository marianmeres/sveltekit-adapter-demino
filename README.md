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
    }),
  },
};
```

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
   Immutable assets (`/_app/immutable/*`) are served with
   `Cache-Control: public, immutable, max-age=31536000`.

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
- Your Deno server's `deno.json` needs to map `@sveltejs/kit` as an npm import
  (the SvelteKit server bundle references it at runtime):
  ```json
  {
    "imports": {
      "@sveltejs/kit": "npm:@sveltejs/kit@^2.0.0",
      "@sveltejs/kit/internal": "npm:@sveltejs/kit/internal",
      "@sveltejs/kit/internal/server": "npm:@sveltejs/kit/internal/server"
    }
  }
  ```

## License

[MIT](LICENSE)
