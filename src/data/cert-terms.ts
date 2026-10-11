// Spice Certificate terms pin (rendered at /certificates/terms/, only built when SPICE_CERTS_LIVE=1).
// TO SWAP the terms (only a file Sajan approved), e.g. the pending 2026.10.10.3:
//   1. cp <approved file> src/content-static/SPICE-CERT-TERMS.md
//   2. change the ONE line below: sha256, VERSION, and STATUS ('final' only once Sajan has approved it as the launch text).
// test/spice-holder.test.mjs checks the file against this sha, and refuses SPICE_CERTS_LIVE="1" in production while STATUS != 'final'.
// Current: TERMS-FINAL-v4.md v2026.10.10.4 (Siona passed, parent 10:31 PM PT 10/10): the launch text, so STATUS final.
export const CERT_TERMS_SHA256 = 'd7a9d0f9942add13ff924381cf8f8e79758b3d9216f544af5bbc67f31c41326c'; export const CERT_TERMS_VERSION = '2026.10.10.4'; export const CERT_TERMS_STATUS: 'interim' | 'final' = 'final';
