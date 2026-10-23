-- Bitácora persistente de operaciones externas y locales en curso.
-- Permite recuperar trabajo interrumpido por reinicios o fallos parciales.
-- El script es idempotente; no debe ejecutarse dentro de una transacción
-- administrada por una herramienta que ya abra una.

BEGIN;

CREATE TABLE IF NOT EXISTS reservations.reconciliation_operations (
    id uuid PRIMARY KEY,
    operation_type text NOT NULL,
    reservation_id uuid,
    session_id uuid,
    space_id uuid,
    request_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 1,
    max_attempts integer NOT NULL DEFAULT 10,
    next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
    locked_by text,
    locked_at timestamptz,
    last_error text,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    CONSTRAINT reconciliation_operations_type_valid
        CHECK (operation_type IN (
            'reserve_space',
            'release_space',
            'occupy_space',
            'checkout_space',
            'restore_space',
            'cancel_reservation'
        )),
    CONSTRAINT reconciliation_operations_status_valid
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT reconciliation_operations_attempts_valid
        CHECK (attempts >= 0 AND max_attempts >= 1),
    CONSTRAINT reconciliation_operations_lock_consistency
        CHECK (
            (status = 'processing' AND locked_by IS NOT NULL AND locked_at IS NOT NULL)
            OR (status <> 'processing')
        )
);

-- Evita dos operaciones abiertas para el mismo recurso y tipo. Las columnas
-- nulas se normalizan para que el índice parcial sea efectivo.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_operations_one_open_per_resource_idx
    ON reservations.reconciliation_operations (
        operation_type,
        COALESCE(reservation_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS reconciliation_operations_claim_idx
    ON reservations.reconciliation_operations (status, next_attempt_at, created_at)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS reconciliation_operations_reservation_idx
    ON reservations.reconciliation_operations (reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_operations_session_idx
    ON reservations.reconciliation_operations (session_id, created_at DESC);

COMMIT;
