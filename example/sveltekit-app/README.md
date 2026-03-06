# Example SvelteKit App

A bare-bones SvelteKit app wired to use `@marianmeres/sveltekit-adapter-demino`.
Used for testing and demonstrating the adapter.

## How it works

- `svelte.config.js` imports the adapter from `@marianmeres/sveltekit-adapter-demino`
- `package.json` links the adapter locally via `file:../../.npm-dist`
- `vite build` produces `build/handler.js` which is imported by `../server.ts`

## Build & Run

```bash
# 1. Build the adapter as an npm package (from project root)
deno task npm:build

# 2. Install dependencies
pnpm install

# 3. Build the SvelteKit app
pnpm build

# 4. Run the Deno server (from example/)
cd .. && deno run -A server.ts
```

Then open:
- http://localhost:9999/ -- SvelteKit pages
- http://localhost:9999/api/hello -- demino API endpoint

## Routes

- `/` -- Home page
- `/about` -- About page
- `/contact` -- Contact page

## Notes

- After changing adapter source, re-run `deno task npm:build` from the project
  root, then `pnpm install && pnpm build` here to pick up the changes.
- The Deno server at `../server.ts` composes a demino API (`/api/*`) with the
  SvelteKit handler (everything else).
