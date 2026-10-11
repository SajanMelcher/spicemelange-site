#!/usr/bin/env bash
# Build the pinned verifier bundle for setup_caps.py (V4-2). Prints the sha256 to pin in setup_caps.py.
set -euo pipefail; cd "$(dirname "$0")/.."
OUT=/workspace/ixians/spice-certificates/verifier; mkdir -p $OUT
node_modules/.bin/esbuild scripts/proof-verify-entry.mjs --bundle --platform=node --format=esm --target=node20 \
  --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" --outfile=$OUT/verify-proof.bundle.mjs --log-level=warning
git rev-parse HEAD > $OUT/SOURCE_COMMIT
sha256sum $OUT/verify-proof.bundle.mjs
