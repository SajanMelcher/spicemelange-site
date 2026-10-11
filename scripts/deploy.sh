#!/usr/bin/env bash
# One-command deploy. `npm run deploy` = PRODUCTION (main only, clean tree, tests green).
# `npm run deploy:preview` = preview deploy of the current branch (never production).
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-production}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
W="npx --yes -p node@22 -p wrangler -- wrangler"
if [ "$MODE" = "production" ]; then
  [ "$BRANCH" = "main" ] || { echo "Refusing: production deploys only from main (on $BRANCH). Use npm run deploy:preview." >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "Refusing: working tree not clean." >&2; exit 1; }
  TARGET=main
else
  [ "$BRANCH" != "main" ] || { echo "Refusing: preview deploys must come from a non-main branch." >&2; exit 1; }
  TARGET="$BRANCH"
fi
# Siona SJ1/SJ9: build-time switches come ONLY from wrangler.toml for this target (the same values the Pages runtime gets).
# Any exported shell value is cleared first. To flip production singles off, edit the ONE line in wrangler.toml [vars].
unset STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE
VT=$([ "$MODE" = "production" ] && echo production || echo preview)
STORE_SINGLES_FOR_SALE="$(node scripts/wrangler-var.mjs STORE_SINGLES_FOR_SALE "$VT")"
SPICE_CERTS_LIVE="$(node scripts/wrangler-var.mjs SPICE_CERTS_LIVE "$VT")"
export STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE
echo "deploy: $MODE build with STORE_SINGLES_FOR_SALE=$STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE=$SPICE_CERTS_LIVE (from wrangler.toml)"
npm run -s test:store
npm run -s build
# Siona LOW: run the tests again on the fresh build, so the built-pages checks (email_off, dist/learn, /learn/ copy) see this dist.
npm run -s test:store
# The free course is live on production (Sajan 9:31 AM PT 10/10; GL14 retired): refuse a prod build WITHOUT it,
# so a stale branch can't silently take /learn/ down.
if [ "$MODE" = "production" ] && [ ! -e dist/learn/index.html ]; then echo "Refusing: dist/learn/ missing from a production build." >&2; exit 1; fi
$W pages deploy dist --project-name spicemelange-site --branch "$TARGET" --commit-dirty=true
