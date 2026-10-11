// Spice Certificates page copy hooks.
// TLEILAXU HOOK (Sajan 8:21 PM PT 10/10): Tleilaxu is drafting the footer line about borrowing (a last resort). Ixians do not
// write borrowing disclosures. Sajan approved this exact line 8:36 PM PT 10/10 (Tleilaxu's text, verbatim). Rendered ONLY on
// /certificates/ and /certificates/holder/ (not the home page). Other FOOTER-WORDING-DRAFT.md rewordings are NOT approved.
// FOOTER-LINE-v3.txt (sha256 4c2757c5…8237; Sajan approved 9:50 PM PT 10/10 via Tleilaxu), verbatim; copy kept in
// src/content-static/CERT-FOOTER-LINE-v3.txt (test pins sha + equality). Replaces the v2 (9:19 PM) line. Cert pages only.
export const TLEILAXU_CERT_FOOTER_LINE: string | null = "The Spice Melange trading desk trades on Sui with no leverage and no borrowed money. Certificate money is received in the issuer's own exchange account and then held: 38% as a USDC reserve on Sui and 62% in STRC on a third-party platform, and the desk's automated trading only rebalances back to that split. Certificate withdrawals are paid from the reserve and by selling STRC or other assets, even at a loss; the desk does not borrow to pay them.";
// Sajan 8:21 PM PT 10/10 (via Tleilaxu): withdrawal payouts are priced at the Coinbase market price at the time of withdrawal.
export const PAYOUT_PRICING = 'Payouts are priced at the Coinbase market price at the time of withdrawal.';
export const TESTNET_BANNER = 'Testnet preview: no real purchases yet.';
