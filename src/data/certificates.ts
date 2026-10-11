// Spice Certificates page copy hooks.
// TLEILAXU HOOK (Sajan 8:21 PM PT 10/10): Tleilaxu is drafting the footer line about borrowing (a last resort). Ixians do not
// write borrowing disclosures. Sajan approved this exact line 8:36 PM PT 10/10 (Tleilaxu's text, verbatim). Rendered ONLY on
// /certificates/ and /certificates/holder/ (not the home page). Other FOOTER-WORDING-DRAFT.md rewordings are NOT approved.
// FOOTER-LINE-v3.txt (sha256 4c2757c5…8237; Sajan approved 9:50 PM PT 10/10 via Tleilaxu), verbatim; copy kept in
// src/content-static/CERT-FOOTER-LINE-v3.txt (test pins sha + equality). Replaces the v2 (9:19 PM) line. Cert pages only.
export const TLEILAXU_CERT_FOOTER_LINE: string | null = "The Spice Melange trading desk trades on Sui with no leverage and no borrowed money. Certificate money is received in the issuer's own exchange account and then held: 38% as a USDC reserve on Sui and 62% in STRC on a third-party platform, and the desk's automated trading only rebalances back to that split. Certificate withdrawals are paid from the reserve and by selling STRC or other assets, even at a loss; the desk does not borrow to pay them.";
// Tleilaxu's restatements of terms v2026.10.10.3 (2f6f6eab), Sajan-approved copy 9:55 PM PT 10/10, verbatim (tests pin each line). Kept unchanged under v2026.10.10.4 (footer/join stay v3, parent 10:31 PM PT).
export const PAYOUT_PRICING = "Bitcoin payouts are priced at the market price on the exchange we use for payouts, when the payout is made, and sent by hand after approval.";
export const WITHDRAW_STEPS = "To withdraw: send the on-chain redemption request from your wallet (a small Sui gas fee), sign the request on this page with the same wallet, and confirm by email from the address on file to reserve@thespicemelange.org. Sajan approves each payout by hand. We aim to pay within 6 hours of a verified request; that is a target, not a promise.";
export const WITHDRAW_BOX = "Withdrawals need an on-chain request, a signed request, email confirmation and manual approval.";
export const RATE_IN_PRACTICE = "about 7.3% to 7.9% a year in practice, depending on the bitcoin price.";
export const BUY_NO_CAP = "There is no cap on how many certificates are issued.";
export const BUY_PAUSE = "We can pause new sales or stop the automated minting key at any time. Pausing never blocks a withdrawal request.";
export const BUY_WRONG_PAYMENT = "Payments sent the wrong way (wrong amount, from an exchange, or from a wallet without a qualifying license) get no certificate. We refund them by hand and pay the network fee.";
export const TESTNET_BANNER = 'Testnet preview: no real purchases yet.';
