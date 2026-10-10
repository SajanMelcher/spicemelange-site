-- PRODUCTION ONLY (applied by hand with `wrangler d1 execute spicemelange-store-prod --remote --file ...`; not in migrations/,
-- so preview never gets it). Sajan's desk, Ixians 2026-10-10: E2E tests run on PREVIEW only. Production refuses any paid
-- order row that is not a mainnet order, or that carries a synthetic digest or a test email.
CREATE TRIGGER IF NOT EXISTS orders_no_synthetic_paid_insert BEFORE INSERT ON orders
WHEN NEW.status = 'paid' AND (NEW.net <> 'mainnet' OR NEW.digest IS NULL OR NEW.digest LIKE 'E2E-%' OR lower(COALESCE(NEW.email, '')) LIKE '%.invalid')
BEGIN SELECT RAISE(ABORT, 'synthetic_paid_order_refused: run E2E tests on preview'); END;
CREATE TRIGGER IF NOT EXISTS orders_no_synthetic_paid_update BEFORE UPDATE OF status, digest, net, email ON orders
WHEN NEW.status = 'paid' AND (NEW.net <> 'mainnet' OR NEW.digest IS NULL OR NEW.digest LIKE 'E2E-%' OR lower(COALESCE(NEW.email, '')) LIKE '%.invalid')
BEGIN SELECT RAISE(ABORT, 'synthetic_paid_order_refused: run E2E tests on preview'); END;
