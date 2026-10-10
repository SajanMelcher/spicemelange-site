#!/usr/bin/env bash
# Weekly Grok Bot template release.
#   bash scripts/release-templates.sh "<one-line summary>" ["note 1" "note 2" ...]
#   TEMPLATE_VERSION=2026.10.16 to override the date-based version (default: today, YYYY.MM.DD, box time).
#   TEMPLATES_SRC=<dir> imports upstream ZIPs + SHA256SUMS (e.g. portfolio-desk/templates/v1.0.0/dist) via
#     products-private/import_packs.py instead of generating them with build.py. Same-day re-release: 2026.10.09.1.
#   RELEASE_SKUS="a b c" limits the release entry to those slugs (default: all). Upstream ZIPs already named
#     <slug>-v<VERSION>.zip are copied byte for byte (hashes = upstream SHA256SUMS).
#   RELEASE_KEY=<pem> ed25519 release key (default: portfolio-desk/store/release-key/, never in the repo).
#   DRY_RUN=1 builds, sanitizes and tests but uploads, commits and deploys nothing.
#   The retired full-desk file is never re-uploaded: past Full Desk orders keep their original pack.
# Steps: bump version in store-core/templates.json -> rebuild ZIPs (products-private/build.py) -> 0-hit sanitize
# -> record sha256 -> sign versions.json (versions.json.sig) -> tests -> upload ZIPs to the private STORE_FILES KV (production + preview) -> commit + push main -> npm run deploy
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
RELEASE_SKUS="${RELEASE_SKUS:-}" python3 - "$VERSION" "$SUMMARY" "$@" <<'PY'
import json, os, sys, datetime
v, summary, notes = sys.argv[1], sys.argv[2], sys.argv[3:]
skus = os.environ["RELEASE_SKUS"].split() or "all"
p = 'store-core/templates.json'; t = json.load(open(p))
y, m, d = (int(x) for x in v.split('.')[:3])
t['releases'] = [r for r in t['releases'] if r['version'] != v]
t['releases'].insert(0, {'version': v, 'date': datetime.date(y, m, d).isoformat(), 'skus': skus, 'summary': summary, 'notes': notes})
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

# Record each ZIP's SHA-256 in templates.json (published as versions.json sha256 for auto-update verification).
python3 - "$ZDIR" "$VERSION" <<'PY'
import hashlib, json, os, sys
zdir, v = sys.argv[1], sys.argv[2]; p = 'store-core/templates.json'; t = json.load(open(p))
for x in t['templates'] + t['packs']:
    for n in (f"{x['sku']}-v{v}.zip", f"{x['sku']}.zip"):
        f = os.path.join(zdir, n)
        if os.path.exists(f): x['sha256'] = hashlib.sha256(open(f, 'rb').read()).hexdigest(); break
open(p, 'w').write(json.dumps(t, indent=2, ensure_ascii=False) + '\n')
PY

# Signed remote config: static public/templates/versions.json + versions.json.sig (ed25519, key off-repo).
node scripts/versions-sign.mjs sign

# 3. Tests (include the signature check).
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
git add store-core/templates.json public/templates/versions.json public/templates/versions.json.sig
git commit -q -m "Templates release $VERSION: $SUMMARY"
git push -q origin main
npm run deploy

# 6. Verify the public remote config (Pages can take a few seconds to propagate).
sleep 15
curl -fsS https://thespicemelange.org/templates/versions.json | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['current']=='$VERSION', d['current']; print('live versions.json current =', d['current'])"
curl -fsS -o /tmp/vj https://thespicemelange.org/templates/versions.json && curl -fsS -o /tmp/vj.sig https://thespicemelange.org/templates/versions.json.sig \
  && node -e "const c=require('crypto'),f=require('fs');const raw=Buffer.from(f.readFileSync('public/templates/release-key.pub','utf8').trim(),'base64');const k=c.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});if(!c.verify(null,f.readFileSync('/tmp/vj'),k,Buffer.from(f.readFileSync('/tmp/vj.sig','utf8').trim(),'base64')))throw new Error('live signature FAILED');console.log('live versions.json signature verifies')"
