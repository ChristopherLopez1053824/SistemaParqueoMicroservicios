-- Soporte mínimo para coordinar reservas de forma atómica con Reservation Service.
-- La tabla parking.parking_spaces pertenece a Parking Service.
-- Si la tabla todavía no existe, este script crea una versión mínima compatible.

BEGIN;

CREATE SCHEMA IF NOT EXISTS parking;

CREATE TABLE IF NOT EXISTS parking.parking_spaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    level text,
    space_type text,
    status text NOT NULL DEFAULT 'available',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    reserved_by_reservation_id uuid,
    CONSTRAINT parking_spaces_status_valid
        CHECK (status IN ('available', 'reserved', 'occupied', 'maintenance'))
);

ALTER TABLE parking.parking_spaces
    ADD COLUMN IF NOT EXISTS reserved_by_reservation_id uuid;

ALTER TABLE parking.parking_spaces
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS parking_spaces_reserved_by_reservation_idx
    ON parking.parking_spaces (reserved_by_reservation_id);

CREATE INDEX IF NOT EXISTS parking_spaces_status_idx
    ON parking.parking_spaces (status);

COMMIT;
