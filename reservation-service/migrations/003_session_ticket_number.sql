-- Agrega un número de ticket legible y estable para las sesiones de parqueo.
-- No sustituye el id (uuid) interno: es solo una forma amigable de identificar
-- la sesión en la interfaz (formato de presentación: PAR-000123).
-- Idempotente: no falla si ya se ejecutó antes.

BEGIN;

ALTER TABLE reservations.parking_sessions
    ADD COLUMN IF NOT EXISTS ticket_number bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_ticket_number_idx
    ON reservations.parking_sessions (ticket_number);

-- Soporta la búsqueda de sesiones por placa (coincidencia por prefijo) desde la interfaz.
CREATE INDEX IF NOT EXISTS parking_sessions_vehicle_plate_upper_idx
    ON reservations.parking_sessions (UPPER(vehicle_plate));

COMMIT;
