// Spice Certificates page copy hooks.
// TLEILAXU HOOK (Sajan 8:21 PM PT 10/10): Tleilaxu is drafting the footer line about borrowing (a last resort). Ixians do not
// write borrowing disclosures. Sajan approved this exact line 8:36 PM PT 10/10 (Tleilaxu's text, verbatim). Rendered ONLY on
// /certificates/ and /certificates/holder/ (not the home page). Other FOOTER-WORDING-DRAFT.md rewordings are NOT approved.
// FOOTER-LINE-v2.txt (sha256 64ff22a9…7a1db; Sajan approved 9:19 PM PT 10/10 via Tleilaxu), verbatim; copy kept in
// src/content-static/CERT-FOOTER-LINE-v2.txt (test pins sha + equality). Replaces the 8:53 PM line. Cert pages only.
export const TLEILAXU_CERT_FOOTER_LINE: string | null = "The Spice Melange trading desk trades on Sui with no leverage and no borrowed money. Certificate money is held in the issuer's own accounts: a USDC reserve on Sui, a small portion of which funds the desk's automated trading, and STRC on a third-party platform. The desk may borrow against bitcoin only as a last resort to pay certificate withdrawals, and only with the owner's explicit approval.";
// Sajan 8:21 PM PT 10/10 (via Tleilaxu): withdrawal payouts are priced at the Coinbase market price at the time of withdrawal.
export const PAYOUT_PRICING = 'Payouts are priced at the Coinbase market price at the time of withdrawal.';
export const TESTNET_BANNER = 'Testnet preview: no real purchases yet.';
