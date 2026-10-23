-- Agrega reservas programadas por franja horaria: anticipación, vencimiento
-- por no-show, y rechazo de horarios superpuestos para una misma plaza.
--
-- Decisión de producto (antes no estaba definida en el proyecto):
--   - starts_at / ends_at: franja horaria solicitada por el usuario. Es
--     metadata de AGENDA, no un candado físico en tiempo real: Parking
--     Service sigue teniendo un único estado por plaza (available/reserved/
--     occupied/maintenance), sin ventanas de tiempo.
--   - space_claimed_at: momento en que esa franja reclamó efectivamente la
--     plaza física (vía Parking Service). NULL mientras la reserva es una
--     franja futura aún no reclamada. Se reclama en el check-in
--     (ReservationService.registerEntry) o se cancela sola por no-show
--     (ExpirationService), nunca antes.
--   - El índice "una reserva confirmada por plaza, sin importar el horario"
--     (001_init.sql) se reemplaza por una restricción de EXCLUSIÓN que solo
--     prohíbe franjas horarias que se superponen: una plaza puede tener
--     varias reservas confirmadas futuras en franjas distintas.
--
-- Idempotente: seguro de ejecutar aunque ya se haya aplicado.

BEGIN;

DROP INDEX IF EXISTS reservations.reservations_one_confirmed_per_space_idx;

ALTER TABLE reservations.reservations
    ADD COLUMN IF NOT EXISTS starts_at timestamptz,
    ADD COLUMN IF NOT EXISTS ends_at timestamptz,
    ADD COLUMN IF NOT EXISTS space_claimed_at timestamptz;

-- Reservas creadas antes de este cambio: eran siempre inmediatas y ya tenían
-- la plaza reclamada desde su creación.
UPDATE reservations.reservations
SET starts_at = created_at,
    ends_at = created_at + INTERVAL '4 hours',
    space_claimed_at = created_at
WHERE starts_at IS NULL;

ALTER TABLE reservations.reservations
    ALTER COLUMN starts_at SET NOT NULL,
    ALTER COLUMN ends_at SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reservations_ends_after_starts'
    ) THEN
        ALTER TABLE reservations.reservations
            ADD CONSTRAINT reservations_ends_after_starts CHECK (ends_at > starts_at);
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ninguna plaza puede tener dos reservas CONFIRMADAS con franjas horarias que
-- se superpongan. Esta es la protección real contra "reservas superpuestas
-- por horario"; sustituye al índice de "una confirmada por plaza" de arriba.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_overlap_per_space'
    ) THEN
        ALTER TABLE reservations.reservations
            ADD CONSTRAINT reservations_no_overlap_per_space
            EXCLUDE USING gist (
                space_id WITH =,
                tstzrange(starts_at, ends_at, '[)') WITH &&
            ) WHERE (status = 'confirmed');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS reservations_starts_at_idx
    ON reservations.reservations (starts_at)
    WHERE status = 'confirmed';

COMMIT;
