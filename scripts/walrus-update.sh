#!/usr/bin/env bash
# `npm run walrus:update` = rebuild and (re)deploy the Walrus Sites mirror at https://spicemelange.wal.app
# Paid by the desk's Walrus ARCHIVIST wallet (keep the Other Memory archive reserve: >= 30 days of runs + 0.5 SUI).
# The mirror EXCLUDES /store, /certificates and /api (checkout needs Cloudflare Functions). First deploy writes object_id into ws-resources.json; later runs update that site.
# Tooling: /home/box/agent-data/shared/portfolio-desk/walrus/site (see portfolio-desk/website/PLAN.md "Walrus mirror").
set -euo pipefail
cd "$(dirname "$0")/.."
S=/home/box/agent-data/shared/portfolio-desk/walrus/site
EPOCHS="${WALRUS_EPOCHS:-26}"
# Siona SJ18: the mirror is a PRODUCTION build. Same flags as deploy.sh production, read from wrangler.toml [vars] (fail closed).
unset STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE HOME_FUNDS_LINE_LIVE SPICE_CERT_REDEEM_NETWORK
STORE_SINGLES_FOR_SALE="$(node scripts/wrangler-var.mjs STORE_SINGLES_FOR_SALE production)"
SPICE_CERTS_LIVE="$(node scripts/wrangler-var.mjs SPICE_CERTS_LIVE production)"
HOME_FUNDS_LINE_LIVE="$(node scripts/wrangler-var.mjs HOME_FUNDS_LINE_LIVE production)"
SPICE_CERT_REDEEM_NETWORK="$(node scripts/wrangler-var.mjs SPICE_CERT_REDEEM_NETWORK production)"
export STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE HOME_FUNDS_LINE_LIVE SPICE_CERT_REDEEM_NETWORK
echo "walrus: production build with STORE_SINGLES_FOR_SALE=$STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE=$SPICE_CERTS_LIVE HOME_FUNDS_LINE_LIVE=$HOME_FUNDS_LINE_LIVE SPICE_CERT_REDEEM_NETWORK=$SPICE_CERT_REDEEM_NETWORK (from wrangler.toml)"
npm run -s build
rm -rf dist-walrus && cp -r dist dist-walrus && rm -rf dist-walrus/store dist-walrus/api dist-walrus/certificates
if grep -rIl -i -E 'certificat|/api/certificates' dist-walrus --exclude=_headers >/dev/null && [ "$SPICE_CERTS_LIVE" != "1" ]; then echo "Refusing: certificate content in a certs-off mirror build (SJ17)" >&2; exit 1; fi
if grep -rIl -E 'href="/(store|certificates)|/api/(checkout|order|pay)' dist-walrus >/dev/null; then echo "Refusing: dist-walrus links to /store or /api" >&2; exit 1; fi
export PATH="$HOME/.local/bin:$PATH"
site-builder -c "$S/sites-config.yaml" --context mainnet \
  --wallet "$S/wallet/client.yaml" --wallet-env mainnet \
  --walrus-binary "$S/walrus-relay-wrapper.py" \
  --walrus-config "$S/walrus-sites-client.yaml" --walrus-context mainnet \
  deploy ${WALRUS_DRY_RUN:+--dry-run} --ws-resources ws-resources.json --epochs "$EPOCHS" dist-walrus
