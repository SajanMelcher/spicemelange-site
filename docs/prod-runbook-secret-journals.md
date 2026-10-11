# Production runbook: The Secret Journals + Spice Certificates code (branch secret-journals-certs)
Ixians, Sat 10/10/2026 ~8:55 PM PT (rev. ~9:30 PM PT: SJ17/SJ21/SJ22/SJ26). Siona SJ4 order. **Do not run until Siona passes the delta check and the parent says go.**
Nothing here deploys certificates: production keeps `SPICE_CERTS_LIVE = "0"` (wrangler.toml [vars]) until the launch.

## What production gets with the flags as committed
- `STORE_SINGLES_FOR_SALE = "1"` (wrangler.toml [vars], ONE line): singles still on sale, /terms/ stays on LICENSE 2026.10.10
  (2271d634). PENDING SAJAN: to take singles off, change that one line to `"0"`. Then the build (deploy.sh reads the same line),
  createOrder (Pages runtime) and /terms/ (LICENSE 2026.10.10.1, 9bd55791) all switch together.
- `HOME_FUNDS_LINE_LIVE = "1"` (SJ21): the home card shows Sajan's 8:53 wording ("No leverage, no borrowed money" / "The Spice
  Melange trading desk trades on Sui with its own funds only."). Settled by Sajan 9:18 PM PT. Set to "0" to fall back to the old card.
- `SPICE_CERTS_LIVE = "0"`: no /certificates/*, no home card, no nav link, no sign-in API (404), live footer text, no
  certificates section on /privacy/. The rename to The Secret Journals and the retired Leto single DO ship.

## Steps (in this order)
0. `cd /workspace/ixians/spicemelange-site && git checkout main && git merge --ff-only secret-journals-certs` (clean tree;
   move the untracked `.shot.mjs` aside and restore it after step 4).
1. **Back up prod D1** (read-only export; it holds customer emails, so restrict permissions BEFORE the file exists, SJ26):
   `umask 077 && mkdir -p /home/box/.ixians-secrets/backups && npx --yes -p node@22 -p wrangler -- wrangler d1 export spicemelange-store-prod --remote --output /home/box/.ixians-secrets/backups/d1-prod-$(date +%Y%m%d-%H%M).sql`
   (created 0600 by the umask; never under the repo or shared/; check with `ls -l`).
2. **Check pending migrations** (read): `... wrangler d1 migrations list spicemelange-store-prod --remote`.
   - If the ONLY pending migration is `0011_spice_nonces.sql`: `... wrangler d1 migrations apply spicemelange-store-prod --remote`.
   - If anything else is pending: STOP, or run just that file:
     `... wrangler d1 execute spicemelange-store-prod --remote --file migrations/0011_spice_nonces.sql` (additive: CREATE ... IF NOT EXISTS).
3. **Fresh SPICE_SESSION_SECRET for production** (>= 32 chars, different from preview; never on argv, never echoed):
   `openssl rand -base64 48 | tr -d '\n' | npx --yes -p node@22 -p wrangler -- wrangler pages secret put SPICE_SESSION_SECRET --project-name spicemelange-site`
   (wrangler reads the value from stdin). With SPICE_CERTS_LIVE=0 it is unused until launch; setting it now means the launch is a
   flag flip only. If code + secret ever land before 0011, sign-in fails closed (503): availability only.
4. **Deploy**: `npm run deploy` (main only, clean tree; tests run twice; deploy.sh UNSETS any exported STORE_SINGLES_FOR_SALE /
   SPICE_CERTS_LIVE and reads both from wrangler.toml [vars]; it prints the values it used: check `STORE_SINGLES_FOR_SALE=1 SPICE_CERTS_LIVE=0 HOME_FUNDS_LINE_LIVE=1`; the build log must show
   `certs-launch-gate ... removed 3 unreferenced _astro chunk(s)` and no SJ17 error).
5. **Verify** (GET only): no certificate chunk is served (SJ17/SJ26):
   `for f in $(curl -s https://thespicemelange.org/ https://thespicemelange.org/store/ | grep -oE '/_astro/[^"]+\.js' | sort -u); do curl -s https://thespicemelange.org$f | grep -il certificat && echo "LEAK $f"; done`
   and `grep -ril certificat dist --exclude=_headers` printed nothing before upload · home card reads "No leverage, no borrowed money" /
   "...trades on Sui with its own funds only." · `/certificates/` 404 · `/api/certificates/challenge` 404 · home has no Certificates link/card ·
   `/store/catalog.json` lists The Secret Journals and no leto-journals · `/store/leto-journals/` 301 · `/terms/` version matches
   the singles switch · footer text unchanged.

6. **Hwi's lesson worker (SJ22; Hwi's worker: tell Hwi first).** deploy.sh does not redeploy `workers/hwi-lessons`, which bundles
   store-core/lessons-content.js, so prod lesson emails keep "The Dune Saga Collection" until it is redeployed. From main:
   `cd workers/hwi-lessons && npx --yes -p wrangler@4 wrangler deploy --dry-run --outdir /tmp/hwi-lessons-check` (check), then
   `npx --yes -p wrangler@4 wrangler deploy`. Note: three "Dune Saga Collection" strings stay in the bundle from the SIGNED versions.json
   (release notes; not re-signed by the Ixians).
7. **Walrus mirror** (only if you refresh it): `npm run walrus:update` now builds with the production flags from wrangler.toml (SJ18)
   and refuses a certs-off mirror that contains certificate content.

## Launch (later; needs Sajan's yes + Siona)
Change `SPICE_CERTS_LIVE` to `"1"` in [vars], `npm run deploy`. Footer option A, nav, home card, /certificates/ (buy page stays a
TESTNET preview), /certificates/terms/ and the /privacy/ section all appear together. The holder API stays testnet-only until a
mainnet certificate package exists (SPICE_CERT_PREVIEW + SUI_NETWORK; SC1/SC9/SJ3/SJ12 first).

## Withdrawal lock (SJ10)
When a request is rejected or paid, the lock clears automatically the next time the ledger shows it; to clear it at once:
`node scripts/spice-withdraw-release.mjs <serial> rejected|paid --env production --yes`.
