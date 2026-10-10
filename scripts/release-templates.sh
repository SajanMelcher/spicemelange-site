#!/usr/bin/env bash
# Weekly Grok Bot template release.
#   bash scripts/release-templates.sh "<one-line summary>" ["note 1" "note 2" ...]
#   TEMPLATE_VERSION=2026.10.16 to override the date-based version (default: today, YYYY.MM.DD, box time).
#   TEMPLATES_SRC=<dir> imports upstream ZIPs + SHA256SUMS (e.g. portfolio-desk/templates/v1.0.0/dist) via
#     products-private/import_packs.py instead of generating them with build.py. Same-day re-release: 2026.10.09.1.
#   DRY_RUN=1 builds, sanitizes and tests but uploads, commits and deploys nothing.
#   The retired full-desk file is never re-uploaded: past Full Desk orders keep their original pack.
# Steps: bump version in store-core/templates.json -> rebuild ZIPs (products-private/build.py) -> 0-hit sanitize
# -> tests -> upload ZIPs to the private STORE_FILES KV (production + preview) -> commit + push main -> npm run deploy
# -> check the live versions.json. Buyers re-download at /store/download and always get what is in KV.
set -euo pipefail
cd "$(dirname "$0")/.."
SUMMARY="${1:?usage: release-templates.sh \"<summary>\" [notes...]}"; shift
VERSION="${TEMPLATE_VERSION:-$(date +%Y.%m.%d)}"
[[ "$VERSION" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]] || { echo "Bad version $VERSION (want YYYY.MM.DD or YYYY.MM.DD.N)" >&2; exit 1; }
[ -f products-private/build.py ] && [ -x products-private/sanitize.sh ] || { echo "Refusing: products-private/ (build.py, sanitize.sh) missing on this machine." >&2; exit 1; }
if [ -z "${DRY_RUN:-}" ]; then
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "Refusing: run from main." >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "Refusing: working tree not clean." >&2; exit 1; }
  git pull --ff-only -q
fi

# 1. Bump the version and prepend the release (re-running the same version replaces its entry).
python3 - "$VERSION" "$SUMMARY" "$@" <<'PY'
import json, sys, datetime
v, summary, notes = sys.argv[1], sys.argv[2], sys.argv[3:]
p = 'store-core/templates.json'; t = json.load(open(p))
y, m, d = (int(x) for x in v.split('.')[:3])
t['releases'] = [r for r in t['releases'] if r['version'] != v]
t['releases'].insert(0, {'version': v, 'date': datetime.date(y, m, d).isoformat(), 'skus': 'all', 'summary': summary, 'notes': notes})
t['releases'].sort(key=lambda r: [int(x) for x in r['version'].split('.')] + [0] * (4 - len(r['version'].split('.'))), reverse=True)
t['current'] = t['releases'][0]['version']
open(p, 'w').write(json.dumps(t, indent=2, ensure_ascii=False) + '\n')
print(f"templates.json: current = {t['current']}")
PY

# 2. Rebuild the ZIPs and run the strict 0-hit sanitize check.
if [ -n "${TEMPLATES_SRC:-}" ]; then
  python3 products-private/import_packs.py "$TEMPLATES_SRC" "$VERSION"
  ZDIR="products-private/zips-$VERSION"
else
  TEMPLATE_VERSION="$VERSION" python3 products-private/build.py >/dev/null
  ZDIR="products-private/zips"
fi
bash products-private/sanitize.sh "$ZDIR"

# 3. Tests.
npm run -s test:store

if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN: built $VERSION; nothing uploaded, committed or deployed."; git diff --stat; exit 0; fi

# 4. Upload to private KV (production first, then preview). Key = catalog `file`, metadata = download name.
W="npx --yes -p node@22 -p wrangler -- wrangler"
PROD_NS=$(awk '/binding = "STORE_FILES"/{getline; print}' wrangler.toml | sed -n '1s/.*"\(.*\)".*/\1/p')
PREV_NS=$(awk '/binding = "STORE_FILES"/{getline; print}' wrangler.toml | sed -n '2s/.*"\(.*\)".*/\1/p')
for z in "$ZDIR"/*.zip; do
  sku=$(basename "$z" .zip); sku="${sku%-v$VERSION}"
  [ "$sku" = full-desk ] && { echo "skip file:full-desk (retired; past orders keep the original)"; continue; }
  meta="{\"name\":\"golden-path-$sku-$VERSION.zip\",\"type\":\"application/zip\",\"version\":\"$VERSION\",\"sha256\":\"$(sha256sum "$z" | cut -d' ' -f1)\"}"
  for ns in "$PROD_NS" "$PREV_NS"; do
    $W kv key put "file:$sku" --path "$z" --namespace-id "$ns" --metadata "$meta" --remote >/dev/null
  done
  echo "uploaded file:$sku ($VERSION)"
done

# 5. Commit, push, deploy (deploy.sh re-runs the tests and refuses a dirty or non-main tree).
git add store-core/templates.json
git commit -q -m "Templates release $VERSION: $SUMMARY"
git push -q origin main
npm run deploy

# 6. Verify the public remote config (Pages can take a few seconds to propagate).
sleep 15
curl -fsS https://thespicemelange.org/templates/versions.json | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['current']=='$VERSION', d['current']; print('live versions.json current =', d['current'])"
