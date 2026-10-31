#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# 1. Build the adapter (dist/); the example app links the repo root
pnpm run build

# 2. Install sveltekit-app dependencies
cd example/sveltekit-app
pnpm install

# 3. Build the SvelteKit app
pnpm build
