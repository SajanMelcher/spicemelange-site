-- 10/9/2026: record the payee on each order, so changing STORE_PAYTO never breaks orders already issued.
-- Rows created before this migration have pay_to NULL and are backfilled out-of-band (the address is not committed).
ALTER TABLE orders ADD COLUMN pay_to TEXT;
