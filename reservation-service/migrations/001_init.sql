-- Esquema propietario del Reservation Service.
-- Ejecutar una sola vez en cada base de datos (Supabase PostgreSQL).
-- El script es idempotente para tablas, índices y restricciones nuevas.

BEGIN;

CREATE SCHEMA IF NOT EXISTS reservations;

CREATE TABLE IF NOT EXISTS reservations.reservations (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL,
    vehicle_plate text NOT NULL,
    status text NOT NULL DEFAULT 'confirmed',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT reservations_vehicle_plate_not_blank
        CHECK (length(btrim(vehicle_plate)) > 0),
    CONSTRAINT reservations_status_valid
        CHECK (status IN ('confirmed', 'cancelled', 'completed'))
);

CREATE INDEX IF NOT EXISTS reservations_space_id_idx
    ON reservations.reservations (space_id);

CREATE INDEX IF NOT EXISTS reservations_status_idx
    ON reservations.reservations (status);

-- Una plaza solo puede tener una reserva activa a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_confirmed_per_space_idx
    ON reservations.reservations (space_id)
    WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS reservations.parking_sessions (
    id uuid PRIMARY KEY,
    reservation_id uuid NOT NULL
        REFERENCES reservations.reservations (id) ON DELETE RESTRICT,
    space_id uuid NOT NULL,
    vehicle_plate text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    entry_at timestamptz NOT NULL,
    exit_at timestamptz,
    duration_seconds integer,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT parking_sessions_vehicle_plate_not_blank
        CHECK (length(btrim(vehicle_plate)) > 0),
    CONSTRAINT parking_sessions_status_valid
        CHECK (status IN ('active', 'completed', 'cancelled')),
    CONSTRAINT parking_sessions_duration_non_negative
        CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    CONSTRAINT parking_sessions_exit_consistency
        CHECK (
            (status = 'active' AND exit_at IS NULL AND duration_seconds IS NULL)
            OR (status = 'completed' AND exit_at IS NOT NULL AND duration_seconds IS NOT NULL)
            OR (status = 'cancelled')
        )
);

CREATE INDEX IF NOT EXISTS parking_sessions_reservation_id_idx
    ON reservations.parking_sessions (reservation_id);

CREATE INDEX IF NOT EXISTS parking_sessions_space_id_idx
    ON reservations.parking_sessions (space_id);

-- Refuerza la regla de una única sesión activa por reserva.
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_one_active_per_reservation_idx
    ON reservations.parking_sessions (reservation_id)
    WHERE status = 'active';

COMMIT;
