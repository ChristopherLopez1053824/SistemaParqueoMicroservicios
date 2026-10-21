-- Esquema payments - Payment Service
-- Convenciones: snake_case en tablas/columnas, UUID como identificadores,
-- fechas TIMESTAMPTZ, importes enteros en centavos (GTQ).
-- Ejecutar en el SQL Editor de Supabase o mediante: npm run migrate

CREATE SCHEMA IF NOT EXISTS payments;

-- Tarifa por hora. La tarifa activa vigente es la de mayor effective_from.
CREATE TABLE IF NOT EXISTS payments.tariffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hourly_rate_minor INTEGER NOT NULL CHECK (hourly_rate_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'GTQ' CONSTRAINT tariffs_currency_gtq CHECK (currency = 'GTQ'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cotizaciones de pago calculadas para una sesion finalizada.
CREATE TABLE IF NOT EXISTS payments.payment_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    billable_hours INTEGER NOT NULL CHECK (billable_hours >= 0),
    hourly_rate_minor INTEGER NOT NULL CHECK (hourly_rate_minor >= 0),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'GTQ' CONSTRAINT payment_quotes_currency_gtq CHECK (currency = 'GTQ'),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_quotes_session_id_idx
    ON payments.payment_quotes (session_id);

-- Pagos simulados. Medidas contra pagos duplicados:
--   * idempotency_key unico (reintentos con la misma Idempotency-Key)
--   * session_id unico (una sola sesion pagada)
--   * quote_id unico (una sola cotizacion consumida)
CREATE TABLE IF NOT EXISTS payments.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL CONSTRAINT payments_session_id_unique UNIQUE,
    quote_id UUID NOT NULL CONSTRAINT payments_quote_id_unique UNIQUE
        REFERENCES payments.payment_quotes (id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CONSTRAINT payments_idempotency_key_unique UNIQUE,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'GTQ' CONSTRAINT payments_currency_gtq CHECK (currency = 'GTQ'),
    method TEXT NOT NULL DEFAULT 'simulated' CONSTRAINT payments_method_simulated CHECK (method = 'simulated'),
    status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT payments_status_valid CHECK (status IN ('pending', 'succeeded', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_session_id_idx
    ON payments.payments (session_id);

-- Tarifa inicial de referencia (Q15.00 por hora, valor ilustrativo del documento).
-- Solo se inserta si la tabla esta vacia; cambiar con:
--   UPDATE payments.tariffs SET is_active = FALSE WHERE is_active = TRUE;
--   INSERT INTO payments.tariffs (hourly_rate_minor, effective_from) VALUES (1800, now());
INSERT INTO payments.tariffs (hourly_rate_minor, currency, is_active)
SELECT 1500, 'GTQ', TRUE
WHERE NOT EXISTS (SELECT 1 FROM payments.tariffs);
