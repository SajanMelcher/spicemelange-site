// Spice Certificate terms pin (rendered at /certificates/terms/, only built when SPICE_CERTS_LIVE=1).
// TO SWAP the terms (only a file Sajan approved), e.g. the pending 2026.10.10.3:
//   1. cp <approved file> src/content-static/SPICE-CERT-TERMS.md
//   2. change the ONE line below: sha256, VERSION, and STATUS ('final' only once Sajan has approved it as the launch text).
// test/spice-holder.test.mjs checks the file against this sha, and refuses SPICE_CERTS_LIVE="1" in production while STATUS != 'final'.
// Current: TERMS-FINAL-v3.md v2026.10.10.3 (Sajan approved 9:50 PM PT 10/10 via Tleilaxu): the launch text, so STATUS final.
export const CERT_TERMS_SHA256 = '2f6f6eaba83c64e7c6dfe6c015bee93d354ede2529d1cf77518d56eaf1e7c3ec'; export const CERT_TERMS_VERSION = '2026.10.10.3'; export const CERT_TERMS_STATUS: 'interim' | 'final' = 'final';
