# Desk signal feed: spec (LIVE)

Status: live on thespicemelange.org. Sajan approved it on 2026-10-10 at 12:08 AM PT: "Yes, put Join the Desk and the signal feed live with those starter rules."

## Starter rules (Sajan, 2026-10-10)
1. Paid buyers post **up to 5 ideas per day**. The count is per order, per UTC day, and only accepted ideas count; rejected attempts don't use a slot. This is enforced in code (`MAX_IDEAS_PER_DAY = 5`). Env can lower it, never raise it. The 6th idea gets 429 `daily_post_limit`.
2. Ideas earn **credit points only when Sajan or the desk grants them**, through the admin key on `/api/signals/moderate`. Nothing is automatic.
3. **Points are non-cashable.** Public responses carry `rules` and `pointsNote`.

## Purpose
Paid template buyers can share trade ideas, and anyone can read them. The `desk-kit` client (`signals list` / `signals post`) talks to this API. Ideas are text plus a few numbers. The server never builds, signs, routes or executes a transaction, every item carries `executable: false`, and the client never feeds ideas into its trading cycle.

## Switches
- `SIGNALS_ENABLED=1` must be set, and the store itself must be enabled. Otherwise every endpoint returns 503 `signals_not_open`. It is set in `wrangler.toml` for both production and preview.
- `SIGNALS_ADMIN_KEY` is a Pages secret of 32 characters or more. Without it, moderation returns 503.
- Optional limits (defaults in brackets):
  - `SIGNALS_POSTS_PER_DAY` [5, max 5] accepted ideas per order per UTC day
  - `SIGNALS_ATTEMPTS_PER_DAY` [20] post attempts per order per day (anti-spam)
  - `SIGNALS_MIN_GAP_SEC` [600] between posts by one author
  - `SIGNALS_READS_PER_MIN` [120] per IP hash
  - `SIGNALS_REPORTS_PER_DAY` [20] per IP hash
  - `SIGNALS_HOLD_AT_REPORTS` [3] distinct reporters

## Endpoints
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/signals?pool=&limit=&before=` | none | Visible ideas, newest first, up to 100. `next` is a cursor. CORS `*`, cached 30 s. Rate-limited per salted IP hash. |
| GET | `/api/signals/:id` | none | One visible idea. Held, hidden and removed ideas return 404. |
| POST | `/api/signals` | `Authorization: Bearer <order token>` | Body `{orderId, idea}`. The order must be **paid**. A token in the body or in the URL is refused. Returns 201 `{id, author, state}`. |
| POST | `/api/signals/:id/report` | none | `{reason}`. Counts one report per reporter per idea. Enough distinct reports put the idea on hold. |
| POST | `/api/signals/moderate` | `Authorization: Bearer <SIGNALS_ADMIN_KEY>` | `{id, action, points?, note?}`. Actions: `hide`, `restore`, `remove`, `hold`, `credit`, `bounty`. Every action is written to an audit log. |

## Idea schema
```json
{ "pool": "BASE_QUOTE", "side": "buy|sell|watch", "thesis": "20-1200 chars",
  "entry": 1.0, "target": 1.1, "invalidation": 0.95, "horizonHours": 48,
  "confidence": "low|medium|high", "tags": ["up-to-5", "a-z0-9-"] }
```
- Unknown fields are rejected, for example `tx`, `execute` or `signature`.
- Numbers must be positive and finite.

## Moderation (automatic, then human)
- **Reject (422):**
  - links and domains
  - `0x…` or long hex strings (addresses and ids, as anti-phishing)
  - private keys, seed phrases and PEM blocks
  - emails and phone numbers
  - "send to my wallet" requests
- **Hold for review:** hype ("guaranteed", "risk-free", "50x"…), promotion ("DM me", "paid group"), and mostly upper-case text.
- **Duplicates:** the same author with the same normalized thesis gets 409.
- **Reports:** N distinct reporters put an idea on `held`. A moderator then restores, hides or removes it.

## Attribution and credit
- The public `author` is the pseudonym `spice-<hmac(order id)>`. It stays the same for one order, and the order id is never shown.
- `signals.order_id` is stored privately, so granted credit can be tied to the buyer. Points and bounties are recognition only; they are non-cashable.
- `GET /api/signals/contributors` lists pseudonyms with idea counts and granted points.
- `signal_credits` is append-only, and only admins can write to it. Items show `credits: {points, bounties}`.

## Data (`migrations/0004_signals.sql`)
Tables: `signals`, `signal_reports`, `signal_credits`, `signal_mod_log`, `signal_hits`. IPs are stored only as salted hashes, the same scheme the store uses.

## Code
- `store-core/signals.js`: validation, moderation, limits, the CRUD operations and attribution
- `store-core/signals-http.js`: the feature switch and JSON helpers
- `store-core/core.js`: adds `paidOrder(cfg, orderId, token)`, a read-only check
- `functions/api/signals/index.js`, `[id].js`, `[id]/report.js`, `moderate.js`
- `functions/api/signals/contributors.js`
- `test/signals.test.mjs`: 11 tests. Run with `npx -p node@22 -- node --test test/signals.test.mjs`.

## Go-live (2026-10-10)
- The production D1 was backed up, then `0004_signals.sql` was applied.
- `SIGNALS_ENABLED=1` is in production `[vars]`. A new production `SIGNALS_ADMIN_KEY` is set as a Pages secret, with a copy kept outside the repo.
- Moderators: Sajan or the desk, holding the admin key.

## Open questions
- Should read access stay fully anonymous, or need any paid token? The spec says open.
- Should held ideas be visible to their author? Today they aren't.
- How long should ideas be kept? There is no expiry yet.
