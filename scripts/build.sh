#!/usr/bin/env bash
# `npm run build`: build switches come from wrangler.toml. deploy.sh / walrus-update.sh already export them for their target and
# those values win; a bare local build (nothing exported) now uses the PRODUCTION values, so a local build matches what ships
# (Spice Certificates are live in production since 10/10). The SJ17 certs-off gate is unchanged: any build with
# SPICE_CERTS_LIVE=0 still fails if a served file mentions certificates.
set -euo pipefail
cd "$(dirname "$0")/.."
for k in STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE HOME_FUNDS_LINE_LIVE SPICE_CERT_REDEEM_NETWORK WALLET_PAGES_LIVE; do
  if [ -z "${!k+x}" ]; then export "$k=$(node scripts/wrangler-var.mjs "$k" production)"; fi
done
astro build
node scripts/csp-headers.mjs
