// Spice Certificate terms pin (rendered at /certificates/terms/, only built when SPICE_CERTS_LIVE=1).
// TO SWAP the terms (only a file Sajan approved), e.g. the pending 2026.10.10.3:
//   1. cp <approved file> src/content-static/SPICE-CERT-TERMS.md
//   2. change the ONE line below: sha256, VERSION, and STATUS ('final' only once Sajan has approved it as the launch text).
// test/spice-holder.test.mjs checks the file against this sha, and refuses SPICE_CERTS_LIVE="1" in production while STATUS != 'final'.
// Current: TERMS-FINAL.md v2026.10.10.2 (Sajan 9:19 PM PT 10/10), INTERIM: 2026.10.10.3 is pending Sajan, so not final for certs=1.
export const CERT_TERMS_SHA256 = '93bfbef2aa66053c358bf28e92b93cac30ab324834d16345b890d1d95ae73558'; export const CERT_TERMS_VERSION = '2026.10.10.2'; export const CERT_TERMS_STATUS: 'interim' | 'final' = 'interim';
