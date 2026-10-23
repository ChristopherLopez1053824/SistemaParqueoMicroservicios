-- Corrige el invariante real de pagos: "una sola obligación EXITOSA por sesión
-- y por cotización", no "un solo intento total". Las restricciones UNIQUE
-- originales sobre session_id y quote_id bloqueaban cualquier reintento legítimo
-- después de un pago fallido, incluso con una Idempotency-Key distinta.
-- Idempotente: seguro de ejecutar aunque ya se haya aplicado.

BEGIN;

ALTER TABLE payments.payments DROP CONSTRAINT IF EXISTS payments_session_id_unique;
ALTER TABLE payments.payments DROP CONSTRAINT IF EXISTS payments_quote_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS payments_session_id_succeeded_idx
    ON payments.payments (session_id)
    WHERE status = 'succeeded';

CREATE UNIQUE INDEX IF NOT EXISTS payments_quote_id_succeeded_idx
    ON payments.payments (quote_id)
    WHERE status = 'succeeded';

COMMIT;
