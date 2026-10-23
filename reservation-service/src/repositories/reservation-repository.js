const RESERVATION_COLUMNS = `
    id,
    space_id,
    vehicle_plate,
    status,
    created_at,
    updated_at
`;

const SESSION_COLUMNS = `
    id,
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

    async insertReservation({ id, spaceId, vehiclePlate }) {
        const result = await this.client.query(
            `INSERT INTO reservations.reservations (id, space_id, vehicle_plate, status)
             VALUES ($1, $2, $3, 'confirmed')
             RETURNING ${RESERVATION_COLUMNS}`,
            [id, spaceId, vehiclePlate]
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
