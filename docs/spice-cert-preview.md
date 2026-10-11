# Spice Certificates holder page: TESTNET PREVIEW (branch `spice-cert-preview`)
Ixians, 10/10/2026 PT. **Not for production** (gate 2: Sajan's yes). Not linked from nav, noindex, sample data only.

- Page: `/certificates/holder/` (wallet sign-in) and `/certificates/holder/<serial>/<token>` (personal VIEW-ONLY link).
- API: `POST /api/certificates/{challenge,signin,token-view,me,withdraw,wallet,trade-quote}` (`store-core/spice-api.js`).
  Fails closed (503) unless `SUI_NETWORK=testnet` and `SPICE_CERT_PREVIEW=1` (preview vars only) and `SPICE_SESSION_SECRET` (>=32 chars).
- Sign-in: Sui personal-message signature (Ed25519/secp256k1/secp256r1, `store-core/suisig.js`), stateless HMAC nonce
  (5 min, domain-bound), 15-min HMAC session. No gas, no transaction, never a seed phrase.
- Token links: 256-bit token, only `sha256:` hash stored (`token_hash` in the master.json block). Issue/rotate/revoke:
  `node scripts/spice-holder-token.mjs issue|rotate|revoke --serial N --tokens <registry outside repo> [--master <file>]`.
- Data: exactly `ledger/master.json -> spice_certificates` (schema `store-core/spice-sample/master-spice-block.schema.json`);
  preview bundles a FAKE sample. Display names come only from the private holder file (secret `SPICE_HOLDERS_PRIVATE`), never
  from master.json or the repo.
- Withdrawal: fresh wallet signature over a request naming serial, asset, payout address; queued to KV
  `SPICE_WITHDRAW_QUEUE_TESTNET` if bound (not bound on preview: verified, not stored). Nothing is ever paid by the site.
- Wallet panel: holder's own testnet balances (server-side read of public Sui GraphQL via `src/lib/sui-read.js`); USD is a
  mainnet DeepBook mid reference (testnet tokens have no value).
- Trade panel: DeepBook v3 TESTNET quote + fees + slippage limit (default 1%, max 3%) + dry-run; unsigned tx JSON is given to the
  holder's wallet (Wallet Standard `sui:signAndExecuteTransaction`, chain `sui:testnet`) only if the dry-run passed. The desk never
  holds funds or keys.
- **Seal: not used.** A Seal policy for certificate holders would need a `seal_approve` in a published testnet certificate package;
  that package is not on testnet yet (faucet blocked), so statements are protected by the signature/token-gated API only.
- **Walrus backup: not live here.** The daily hashed ledger snapshot is Anteac's job (script + handoff in the Ixians
  spice-certificates dir). The page does not claim "backed up".
