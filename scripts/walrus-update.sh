#!/usr/bin/env bash
# `npm run walrus:update` = rebuild and (re)deploy the Walrus Sites mirror at https://spicemelange.wal.app
# Paid by the desk's Walrus ARCHIVIST wallet (keep the Other Memory archive reserve: >= 30 days of runs + 0.5 SUI).
# The mirror EXCLUDES /store and /api (checkout needs Cloudflare Functions). First deploy writes object_id into ws-resources.json; later runs update that site.
# Tooling: /home/box/agent-data/shared/portfolio-desk/walrus/site (see portfolio-desk/website/PLAN.md "Walrus mirror").
set -euo pipefail
cd "$(dirname "$0")/.."
S=/home/box/agent-data/shared/portfolio-desk/walrus/site
EPOCHS="${WALRUS_EPOCHS:-26}"
npm run -s build
rm -rf dist-walrus && cp -r dist dist-walrus && rm -rf dist-walrus/store dist-walrus/api
if grep -rIl -E 'href="/store|/api/(checkout|order|pay)' dist-walrus >/dev/null; then echo "Refusing: dist-walrus links to /store or /api" >&2; exit 1; fi
export PATH="$HOME/.local/bin:$PATH"
site-builder -c "$S/sites-config.yaml" --context mainnet \
  --wallet "$S/wallet/client.yaml" --wallet-env mainnet \
  --walrus-binary "$S/walrus-relay-wrapper.py" \
  --walrus-config "$S/walrus-sites-client.yaml" --walrus-context mainnet \
  deploy ${WALRUS_DRY_RUN:+--dry-run} --ws-resources ws-resources.json --epochs "$EPOCHS" dist-walrus
