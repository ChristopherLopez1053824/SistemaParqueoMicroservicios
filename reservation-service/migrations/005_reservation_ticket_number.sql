-- Agrega un número de ticket legible y estable para las reservas.
-- Hasta ahora solo las sesiones de parqueo tenían ticket; la reserva era
-- identificable únicamente por su UUID, por lo que el usuario no podía
-- conservar un código práctico desde el momento de crearla.
-- Se usa el mismo formato de presentación que las sesiones (PAR-000123).
-- No sustituye el id (uuid) interno de la reserva.
-- Idempotente: no falla si ya se ejecutó antes.

BEGIN;

ALTER TABLE reservations.reservations
    ADD COLUMN IF NOT EXISTS ticket_number bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_ticket_number_idx
    ON reservations.reservations (ticket_number);

-- Soporta la búsqueda de reservas por placa (coincidencia por prefijo).
CREATE INDEX IF NOT EXISTS reservations_vehicle_plate_upper_idx
    ON reservations.reservations (UPPER(vehicle_plate));

COMMIT;
