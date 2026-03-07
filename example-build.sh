#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# 1. Build the adapter as an npm package
deno task npm:build

# 2. Install sveltekit-app dependencies
cd example/sveltekit-app
pnpm install

# 3. Build the SvelteKit app
pnpm build

