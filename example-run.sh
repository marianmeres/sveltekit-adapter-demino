#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Run the example server (Node, `serve` from @marianmeres/demino/node)
pnpm run example
