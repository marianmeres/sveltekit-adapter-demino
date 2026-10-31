# Example SvelteKit App

A bare-bones SvelteKit app wired to use `@marianmeres/sveltekit-adapter-demino`.
Used for testing and demonstrating the adapter.

## How it works

- `svelte.config.js` imports the adapter from `@marianmeres/sveltekit-adapter-demino`
- `package.json` links the adapter to the repo root via `link:../..` (its `dist/`)
- `vite build` produces `build/handler.js` which is imported by `../server.ts`

## Build & Run

```bash
# 1. Build the adapter (from project root)
pnpm run build

# 2. Install dependencies
pnpm install

# 3. Build the SvelteKit app
pnpm build

# 4. Run the Node server (from project root)
pnpm run example
```

Or all of it from the project root: `pnpm run example:build-run`.

Then open:
- http://localhost:9999/ -- SvelteKit pages
- http://localhost:9999/api/hello -- demino API endpoint

## Routes

- `/` -- Home page
- `/about` -- About page
- `/contact` -- Contact page

## Notes

- After changing adapter source, re-run `pnpm run build` from the project root,
  then `pnpm build` here. The link points at the repo root, so no reinstall is
  needed.
- The Node server at `../server.ts` composes a demino API (`/api/*`) with the
  SvelteKit handler (everything else), served by `@marianmeres/demino/node`.
