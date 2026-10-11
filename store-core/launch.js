// Spice Certificates LAUNCH flag (Siona SJ2). ONE value, SPICE_CERTS_LIVE in wrangler.toml, read at BUILD time (deploy.sh exports
// it from wrangler.toml; pages, nav, home card, footer option A, /privacy/ section) and at RUN time (Pages env;
// /api/certificates/* and the legacy holder route). Default OFF: unset = not launched.
export const certsLive = (env) => String(env?.SPICE_CERTS_LIVE ?? '0') === '1';
const BUILD_ENV = typeof process !== 'undefined' && process?.env ? process.env : {};
export const CERTS_LIVE_AT_BUILD = certsLive(BUILD_ENV);
