// Spice Certificates LAUNCH flag (Siona SJ2). ONE value, SPICE_CERTS_LIVE in wrangler.toml, read at BUILD time (deploy.sh exports
// it from wrangler.toml; pages, nav, home card, footer option A, /privacy/ section) and at RUN time (Pages env;
// /api/certificates/* and the legacy holder route). Default OFF: unset = not launched.
export const certsLive = (env) => String(env?.SPICE_CERTS_LIVE ?? '0') === '1';
const BUILD_ENV = typeof process !== 'undefined' && process?.env ? process.env : {};
export const CERTS_LIVE_AT_BUILD = certsLive(BUILD_ENV);
// Home "No leverage" card wording (Siona SJ21). HOME_FUNDS_LINE_LIVE="1" shows Sajan's 8:53 PM PT wording ("No leverage, no
// borrowed money" / "...trades on Sui with its own funds only."); anything else keeps the LIVE prod card. HELD in production
// until Duncan confirms in writing that the Sui desk holds no loan-draw or family-ledger money. Build time only (deploy.sh and
// walrus-update.sh export it from wrangler.toml).
export const homeFundsLineLive = (env) => String(env?.HOME_FUNDS_LINE_LIVE ?? '0') === '1';
export const HOME_FUNDS_LINE_AT_BUILD = homeFundsLineLive(BUILD_ENV);
