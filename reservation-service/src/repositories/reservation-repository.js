const RESERVATION_COLUMNS = `
    id,
    space_id,
    vehicle_plate,
    status,
    starts_at,
    ends_at,
    space_claimed_at,
    created_at,
    updated_at
`;

const SESSION_COLUMNS = `
    id,
    ticket_number,
    reservation_id,
    space_id,
    vehicle_plate,
    status,
    entry_at,
    exit_at,
    duration_seconds,
    created_at,
    updated_at
`;

const OPERATION_COLUMNS = `
    id,
    operation_type,
    reservation_id,
    session_id,
    space_id,
    request_id,
    payload,
    status,
    attempts,
    max_attempts,
    next_attempt_at,
    locked_by,
    locked_at,
    last_error,
    result,
    created_at,
    updated_at,
    completed_at
`;

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

function errorMessage(error) {
    return String(error && error.message ? error.message : error).slice(0, 4000);
}

class ReservationTransaction {
    constructor(client) {
        this.client = client;
    }

    async lockReservation(id) {
        const result = await this.client.query(
            `SELECT ${RESERVATION_COLUMNS}
             FROM reservations.reservations
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        return result.rows[0] || null;
    }

    async insertReservation({ id, spaceId, vehiclePlate, startsAt, endsAt, spaceClaimedAt = null }) {
        const result = await this.client.query(
            `INSERT INTO reservations.reservations
                (id, space_id, vehicle_plate, status, starts_at, ends_at, space_claimed_at)
             VALUES ($1, $2, $3, 'confirmed', $4, $5, $6)
             RETURNING ${RESERVATION_COLUMNS}`,
            [id, spaceId, vehiclePlate, startsAt, endsAt, spaceClaimedAt]
        );
        return result.rows[0];
    }

    async updateReservationStatus(id, fromStatuses, toStatus) {
        const result = await this.client.query(
            `UPDATE reservations.reservations
             SET status = $2, updated_at = NOW()
             WHERE id = $1 AND status = ANY($3::text[])
             RETURNING ${RESERVATION_COLUMNS}`,
            [id, toStatus, fromStatuses]
        );
        return result.rows[0] || null;
    }

    // Reclama la plaza física al registrar la entrada de una reserva que fue
    // programada a futuro (ver ReservationService.registerEntry).
    async markSpaceClaimed(id, claimedAt) {
        const result = await this.client.query(
            `UPDATE reservations.reservations
             SET space_claimed_at = $2
             WHERE id = $1 AND space_claimed_at IS NULL
             RETURNING ${RESERVATION_COLUMNS}`,
            [id, claimedAt]
        );
        return result.rows[0] || null;
    }

    async findActiveSessionByReservationId(reservationId) {
        const result = await this.client.query(
            `SELECT ${SESSION_COLUMNS}
             FROM reservations.parking_sessions
             WHERE reservation_id = $1 AND status = 'active'
             ORDER BY entry_at DESC
             LIMIT 1
             FOR UPDATE`,
            [reservationId]
        );
        return result.rows[0] || null;
    }

    async insertSession({ id, reservationId, spaceId, vehiclePlate, entryAt }) {
        const result = await this.client.query(
            `INSERT INTO reservations.parking_sessions
                (id, reservation_id, space_id, vehicle_plate, status, entry_at)
             VALUES ($1, $2, $3, $4, 'active', $5)
             RETURNING ${SESSION_COLUMNS}`,
            [id, reservationId, spaceId, vehiclePlate, entryAt]
        );
        return result.rows[0];
    }

    async findSessionById(id) {
        const result = await this.client.query(
            `SELECT ${SESSION_COLUMNS}
             FROM reservations.parking_sessions
             WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    async lockSession(id) {
        const result = await this.client.query(
            `SELECT ${SESSION_COLUMNS}
             FROM reservations.parking_sessions
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        return result.rows[0] || null;
    }

    async completeSession({ sessionId, exitAt, durationSeconds }) {
        const result = await this.client.query(
            `UPDATE reservations.parking_sessions
             SET status = 'completed',
                 exit_at = $2,
                 duration_seconds = $3,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'active'
             RETURNING ${SESSION_COLUMNS}`,
            [sessionId, exitAt, durationSeconds]
        );
        return result.rows[0] || null;
    }

    async completeReservation(reservationId) {
        const result = await this.client.query(
            `UPDATE reservations.reservations
             SET status = 'completed', updated_at = NOW()
             WHERE id = $1 AND status = ANY($2::text[])
             RETURNING ${RESERVATION_COLUMNS}`,
            [reservationId, ['confirmed', 'completed']]
        );
        return result.rows[0] || null;
    }

    async completeOperation({ id, result = null }) {
        const operation = await this.client.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'completed',
                 result = $2,
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND status IN ('pending', 'processing')
             RETURNING ${OPERATION_COLUMNS}`,
            [id, result]
        );
        return operation.rows[0] || null;
    }
}

class ReservationRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async listReservations() {
        const result = await this.pool.query(
            `SELECT ${RESERVATION_COLUMNS}
             FROM reservations.reservations
             ORDER BY created_at DESC, id`
        );
        return result.rows;
    }

    // Reservas confirmadas cuyo plazo de llegada (starts_at + graceMinutes) ya
    // pasó y que nunca registraron una sesión: no-shows a expirar. Usado por
    // ExpirationService.
    async findExpiredNoShowReservations({ graceMinutes, limit = 20 }) {
        const result = await this.pool.query(
            `SELECT ${RESERVATION_COLUMNS}
             FROM reservations.reservations AS r
             WHERE r.status = 'confirmed'
               AND r.starts_at + ($1 * INTERVAL '1 minute') <= NOW()
               AND NOT EXISTS (
                   SELECT 1 FROM reservations.parking_sessions AS s
                   WHERE s.reservation_id = r.id
               )
             ORDER BY r.starts_at
             LIMIT $2`,
            [graceMinutes, limit]
        );
        return result.rows;
    }

    async findReservationById(id) {
        const result = await this.pool.query(
            `SELECT ${RESERVATION_COLUMNS}
             FROM reservations.reservations
             WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    async findSessionById(id) {
        const result = await this.pool.query(
            `SELECT ${SESSION_COLUMNS}
             FROM reservations.parking_sessions
             WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    async listSessions({ status = null, vehiclePlate = null, ticketNumber = null, limit = 50 } = {}) {
        const conditions = [];
        const params = [];

        if (status) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }

        if (vehiclePlate) {
            params.push(`${vehiclePlate.toUpperCase()}%`);
            conditions.push(`UPPER(vehicle_plate) LIKE $${params.length}`);
        }

        if (ticketNumber !== null && ticketNumber !== undefined) {
            params.push(ticketNumber);
            conditions.push(`ticket_number = $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(Math.min(Math.max(1, limit), 100));

        const result = await this.pool.query(
            `SELECT ${SESSION_COLUMNS}
             FROM reservations.parking_sessions
             ${where}
             ORDER BY entry_at DESC
             LIMIT $${params.length}`,
            params
        );
        return result.rows;
    }

    async findOperationById(id) {
        const result = await this.pool.query(
            `SELECT ${OPERATION_COLUMNS}
             FROM reservations.reconciliation_operations
             WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    async createOperation({
        id,
        operationType,
        reservationId = null,
        sessionId = null,
        spaceId = null,
        requestId = null,
        payload = {},
        owner,
        maxAttempts = 10,
        leaseSeconds = 60
    }) {
        try {
            const result = await this.pool.query(
                `INSERT INTO reservations.reconciliation_operations (
                     id,
                     operation_type,
                     reservation_id,
                     session_id,
                     space_id,
                     request_id,
                     payload,
                     status,
                     attempts,
                     max_attempts,
                     locked_by,
                     locked_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', 1, $8, $9, NOW())
                 RETURNING ${OPERATION_COLUMNS}`,
                [
                    id,
                    operationType,
                    reservationId,
                    sessionId,
                    spaceId,
                    requestId,
                    payload,
                    maxAttempts,
                    owner
                ]
            );
            return result.rows[0];
        } catch (error) {
            if (!error || error.code !== '23505') {
                throw error;
            }

            const existing = await this.pool.query(
                `SELECT ${OPERATION_COLUMNS}
                 FROM reservations.reconciliation_operations
                 WHERE operation_type = $1
                   AND COALESCE(reservation_id, '${NULL_UUID}'::uuid) = $2
                   AND COALESCE(session_id, '${NULL_UUID}'::uuid) = $3
                   AND status IN ('pending', 'processing')
                 ORDER BY created_at
                 LIMIT 1
                 FOR UPDATE`,
                [
                    operationType,
                    reservationId || NULL_UUID,
                    sessionId || NULL_UUID
                ]
            );

            const operation = existing.rows[0];

            if (!operation) {
                throw error;
            }

            const lockedAt = operation.locked_at ? new Date(operation.locked_at).getTime() : 0;
            const leaseExpired = !lockedAt || (Date.now() - lockedAt) >= leaseSeconds * 1000;

            if (operation.status === 'processing' && !leaseExpired) {
                const busy = new Error('Ya existe una operación de reconciliación en curso para este recurso.');
                busy.code = 'RECONCILIATION_OPERATION_BUSY';
                busy.operationId = operation.id;
                throw busy;
            }

            const claimed = await this.pool.query(
                `UPDATE reservations.reconciliation_operations
                 SET status = 'processing',
                     payload = $2,
                     request_id = $3,
                     attempts = attempts + 1,
                     locked_by = $4,
                     locked_at = NOW(),
                     last_error = NULL,
                     completed_at = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND status IN ('pending', 'processing')
                 RETURNING ${OPERATION_COLUMNS}`,
                [operation.id, payload, requestId, owner]
            );

            if (!claimed.rows[0]) {
                const busy = new Error('La operación de reconciliación fue tomada por otro proceso.');
                busy.code = 'RECONCILIATION_OPERATION_BUSY';
                busy.operationId = operation.id;
                throw busy;
            }

            return claimed.rows[0];
        }
    }

    async completeOperation({ id, result = null }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'completed',
                 result = $2,
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND status IN ('pending', 'processing')
             RETURNING ${OPERATION_COLUMNS}`,
            [id, result]
        );
        return operation.rows[0] || null;
    }

    async failOperation({ id, owner, error }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'failed',
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = $3,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1
               AND (locked_by = $2 OR locked_by IS NULL)
               AND status IN ('pending', 'processing')
             RETURNING ${OPERATION_COLUMNS}`,
            [id, owner, errorMessage(error)]
        );
        return operation.rows[0] || null;
    }

    async deferOperation({ id, owner, error, delayMs = 0 }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'pending',
                 locked_by = NULL,
                 locked_at = NULL,
                 next_attempt_at = NOW() + ($3 * INTERVAL '1 millisecond'),
                 last_error = $4,
                 updated_at = NOW()
             WHERE id = $1 AND locked_by = $2 AND status = 'processing'
             RETURNING ${OPERATION_COLUMNS}`,
            [id, owner, Math.max(0, delayMs), errorMessage(error)]
        );
        return operation.rows[0] || null;
    }

    async claimNextOperation({ workerId, leaseSeconds }) {
        const operation = await this.pool.query(
            `WITH candidate AS (
                 SELECT id
                 FROM reservations.reconciliation_operations
                 WHERE (status = 'pending' AND next_attempt_at <= NOW())
                    OR (
                        status = 'processing'
                        AND (
                            locked_at IS NULL
                            OR locked_at < NOW() - make_interval(secs => $2)
                        )
                    )
                 ORDER BY next_attempt_at, created_at
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1
             )
             UPDATE reservations.reconciliation_operations AS operation
             SET status = 'processing',
                 attempts = operation.attempts + 1,
                 locked_by = $1,
                 locked_at = NOW(),
                 updated_at = NOW()
             FROM candidate
             WHERE operation.id = candidate.id
             RETURNING operation.*`,
            [workerId, leaseSeconds]
        );
        return operation.rows[0] || null;
    }

    async rescheduleOperation({ id, workerId, error, delayMs }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = CASE
                     WHEN attempts >= max_attempts THEN 'failed'
                     ELSE 'pending'
                 END,
                 next_attempt_at = CASE
                     WHEN attempts >= max_attempts THEN next_attempt_at
                     ELSE NOW() + ($3 * INTERVAL '1 millisecond')
                 END,
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = $4,
                 completed_at = CASE
                     WHEN attempts >= max_attempts THEN NOW()
                     ELSE NULL
                 END,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'processing' AND locked_by = $2
             RETURNING ${OPERATION_COLUMNS}`,
            [id, workerId, Math.max(0, delayMs), errorMessage(error)]
        );
        return operation.rows[0] || null;
    }

    async markOperationCompleted({ id, workerId, result = null }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'completed',
                 result = $3,
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND status = 'processing' AND locked_by = $2
             RETURNING ${OPERATION_COLUMNS}`,
            [id, workerId, result]
        );
        return operation.rows[0] || null;
    }

    async markOperationFailed({ id, workerId, error }) {
        const operation = await this.pool.query(
            `UPDATE reservations.reconciliation_operations
             SET status = 'failed',
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = $3,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND status = 'processing' AND locked_by = $2
             RETURNING ${OPERATION_COLUMNS}`,
            [id, workerId, errorMessage(error)]
        );
        return operation.rows[0] || null;
    }

    async withTransaction(work) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            const transaction = new ReservationTransaction(client);
            const result = await work(transaction);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                // The original error is the relevant one for the caller.
            }
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = {
    ReservationRepository
};
