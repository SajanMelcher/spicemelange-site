// Spice Certificate terms pin. TO SWAP the terms (only a file Sajan approved):
//   1. cp <approved file> src/content-static/SPICE-CERT-TERMS.md   2. change the ONE line below to the new file's sha256 (and VERSION).
// test/spice-holder.test.mjs checks the file against this sha. Pinned: TERMS-FINAL.md v2026.10.10.2, Sajan approved 9:19 PM PT 10/10
// (via Tleilaxu). It replaces both earlier pins; every older terms file is superseded and must not be referenced.
export const CERT_TERMS_SHA256 = '93bfbef2aa66053c358bf28e92b93cac30ab324834d16345b890d1d95ae73558'; export const CERT_TERMS_VERSION = '2026.10.10.2';
