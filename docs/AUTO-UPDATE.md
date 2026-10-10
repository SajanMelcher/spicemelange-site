# Store API for template auto-update (10/9/2026)

All endpoints are on `https://thespicemelange.org`. Tokens never need to be in a URL.

| Call | Auth | Result |
|---|---|---|
| `POST /api/store/status` `{orderId}` | `Authorization: Bearer <token>` (or `token` in the body) | status; for paid orders a fresh `downloadUrl` |
| `GET /api/store/order?id=<orderId>` | `Authorization: Bearer <token>` (legacy `&token=` still works) | same as above |
| `GET /api/store/download?o=..&p=..&e=..&s=..` | HMAC signature in the link | the ZIP (link lives 30 min; never under 15) |
| `GET /api/store/download?o=<orderId>` | `Authorization: Bearer <token>` | the ZIP for a paid order |
| `POST /api/store/download` `{orderId}` | Bearer header or `token` in the body | the ZIP for a paid order |
| `POST /api/store/reset` `{orderId}` | none | a single-use message to sign (10 min) |
| `POST /api/store/reset` `{orderId, message, signature}` | Sui personal-message signature by the paying address | new token; the old one is revoked |

- `downloadUrl` is always a relative path on `/api/store/download`; no redirects, no other hosts. The file is the exact KV bytes
  (`cache-control: no-transform`), and `x-content-sha256` repeats the stored hash.
- Collection orders get the whole collection ZIP; bots extract their own folder and verify against
  `templates["dune-saga-collection"].sha256`. Legacy Full Desk orders keep their original file (retired SKU).
- Rate limits: status + token downloads share a per-order hourly limit (`STORE_STATUS_PER_HOUR`, default 60) kept in D1
  (`status_hits`). They never touch `orders.attempts`, which only counts payment verification. Resets: `STORE_RESET_PER_HOUR` (6).
- Token reset accepts Ed25519, Secp256k1 and Secp256r1 wallet signatures. Multisig, zkLogin and passkey signers, and
  payments sent from an exchange (the sender is the exchange), go through support by email.

## Signed versions.json
- `/templates/versions.json` is a static file generated from `store-core/templates.json` by `scripts/versions-sign.mjs sign`.
- `/templates/versions.json.sig` = base64 ed25519 signature over the exact bytes of versions.json.
- `/templates/release-key.pub` = base64 of the raw 32-byte ed25519 public key. Fingerprint = sha256(raw key):
  `a162ff9587517b66c72a9dbf8f77cd7397896c96d1f60e753f6a3d4e4716a7d7`.
- The private key lives off-repo at `portfolio-desk/store/release-key/release-ed25519.pem` (dir 700, file 600).
  `release-templates.sh` signs on every release; `npm run test:store` fails if versions.json is stale or the signature is bad.
