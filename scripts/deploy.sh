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
npm run -s test:store
npm run -s build
# The free course is live on production (Sajan 9:31 AM PT 10/10; GL14 retired): refuse a prod build WITHOUT it,
# so a stale branch can't silently take /learn/ down.
if [ "$MODE" = "production" ] && [ ! -e dist/learn/index.html ]; then echo "Refusing: dist/learn/ missing from a production build." >&2; exit 1; fi
$W pages deploy dist --project-name spicemelange-site --branch "$TARGET" --commit-dirty=true
