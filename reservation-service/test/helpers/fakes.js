const { ParkingServiceError } = require('../../src/http/parking-client');

function cloneRow(row) {
    if (!row) {
        return null;
    }
    return { ...row };
}

function cloneOperation(operation) {
    if (!operation) {
        return null;
    }

    return {
        ...operation,
        payload: operation.payload ? { ...operation.payload } : {},
        result: operation.result ? { ...operation.result } : null
    };
}

class FakeTransaction {
    constructor(repository) {
        this.repository = repository;
        this.operationChanges = [];
    }

    async lockReservation(id) {
        return cloneRow(this.repository.reservations.get(id));
    }

    async insertReservation({ id, spaceId, vehiclePlate }) {
        if (this.repository.failInsertReservation) {
            throw new Error('Fallo simulado al insertar la reserva.');
        }

        for (const row of this.repository.reservations.values()) {
            if (row.space_id === spaceId && row.status === 'confirmed') {
                const error = new Error('duplicate key value violates unique constraint');
                error.code = '23505';
                throw error;
            }
        }

        const timestamp = this.repository.currentTime();
        const row = {
            id,
            space_id: spaceId,
            vehicle_plate: vehiclePlate,
            status: 'confirmed',
            created_at: timestamp,
            updated_at: timestamp
        };
        this.repository.reservations.set(id, row);
        return cloneRow(row);
    }

    async updateReservationStatus(id, fromStatuses, toStatus) {
        const row = this.repository.reservations.get(id);
        if (!row || !fromStatuses.includes(row.status)) {
            return null;
        }
        row.status = toStatus;
        row.updated_at = this.repository.currentTime();
        return cloneRow(row);
    }

    async findActiveSessionByReservationId(reservationId) {
        for (const row of this.repository.sessions.values()) {
            if (row.reservation_id === reservationId && row.status === 'active') {
                return cloneRow(row);
            }
        }
        return null;
    }

    async findSessionById(id) {
        return cloneRow(this.repository.sessions.get(id));
    }

    async lockSession(id) {
        return cloneRow(this.repository.sessions.get(id));
    }

    async insertSession({ id, reservationId, spaceId, vehiclePlate, entryAt }) {
        if (this.repository.failInsertSession) {
            throw new Error('Fallo simulado al insertar la sesión.');
        }

        for (const row of this.repository.sessions.values()) {
            if (row.reservation_id === reservationId && row.status === 'active') {
                const error = new Error('duplicate key value violates unique constraint');
                error.code = '23505';
                throw error;
            }
        }

        const timestamp = this.repository.currentTime();
        const row = {
            id,
            reservation_id: reservationId,
            space_id: spaceId,
            vehicle_plate: vehiclePlate,
            status: 'active',
            entry_at: entryAt instanceof Date ? entryAt : new Date(entryAt),
            exit_at: null,
            duration_seconds: null,
            created_at: timestamp,
            updated_at: timestamp
        };
        this.repository.sessions.set(id, row);
        return cloneRow(row);
    }

    async completeSession({ sessionId, exitAt, durationSeconds }) {
        if (this.repository.failCompleteSession) {
            throw new Error('Fallo simulado al completar la sesión.');
        }

        const row = this.repository.sessions.get(sessionId);
        if (!row || row.status !== 'active') {
            return null;
        }
        row.status = 'completed';
        row.exit_at = exitAt instanceof Date ? exitAt : new Date(exitAt);
        row.duration_seconds = durationSeconds;
        row.updated_at = this.repository.currentTime();
        return cloneRow(row);
    }

    async completeReservation(reservationId) {
        const row = this.repository.reservations.get(reservationId);
        if (!row || !['confirmed', 'completed'].includes(row.status)) {
            return null;
        }
        row.status = 'completed';
        row.updated_at = this.repository.currentTime();
        return cloneRow(row);
    }

    async completeOperation({ id, result = null }) {
        const operation = this.repository.operations.get(id);

        if (!operation || !['pending', 'processing'].includes(operation.status)) {
            return null;
        }

        this.operationChanges.push({ id, previous: cloneOperation(operation) });

        operation.status = 'completed';
        operation.result = result ? { ...result } : null;
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = null;
        operation.completed_at = this.repository.currentTime();
        operation.updated_at = this.repository.currentTime();

        return cloneOperation(operation);
    }
}

class FakeReservationRepository {
    constructor({ currentTime = () => new Date() } = {}) {
        this.reservations = new Map();
        this.sessions = new Map();
        this.operations = new Map();
        this.currentTime = currentTime;
        this.transaction = new FakeTransaction(this);
        this.queue = Promise.resolve();
        this.failInsertReservation = false;
        this.failInsertSession = false;
        this.failCompleteSession = false;
        this.failListReservations = null;
    }

    async listReservations() {
        if (this.failListReservations) {
            throw this.failListReservations;
        }

        return [...this.reservations.values()]
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
            .map(cloneRow);
    }

    async findReservationById(id) {
        return cloneRow(this.reservations.get(id));
    }

    async findSessionById(id) {
        return cloneRow(this.sessions.get(id));
    }

    async findOperationById(id) {
        return cloneOperation(this.operations.get(id));
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
        const existing = [...this.operations.values()].find((operation) => (
            operation.operation_type === operationType
            && operation.reservation_id === reservationId
            && operation.session_id === sessionId
            && ['pending', 'processing'].includes(operation.status)
        ));

        if (existing) {
            const now = this.currentTime().getTime();
            const lockedAt = existing.locked_at ? new Date(existing.locked_at).getTime() : 0;

            if (existing.status === 'processing' && lockedAt && (now - lockedAt) < leaseSeconds * 1000) {
                const error = new Error('Ya existe una operación de reconciliación en curso para este recurso.');
                error.code = 'RECONCILIATION_OPERATION_BUSY';
                error.operationId = existing.id;
                throw error;
            }

            existing.status = 'processing';
            existing.payload = { ...payload };
            existing.request_id = requestId;
            existing.attempts += 1;
            existing.locked_by = owner;
            existing.locked_at = this.currentTime();
            existing.last_error = null;
            existing.completed_at = null;
            existing.updated_at = this.currentTime();
            return cloneOperation(existing);
        }

        const timestamp = this.currentTime();
        const operation = {
            id,
            operation_type: operationType,
            reservation_id: reservationId,
            session_id: sessionId,
            space_id: spaceId,
            request_id: requestId,
            payload: { ...payload },
            status: 'processing',
            attempts: 1,
            max_attempts: maxAttempts,
            next_attempt_at: timestamp,
            locked_by: owner,
            locked_at: timestamp,
            last_error: null,
            result: null,
            created_at: timestamp,
            updated_at: timestamp,
            completed_at: null
        };

        this.operations.set(id, operation);
        return cloneOperation(operation);
    }

    async completeOperation({ id, result = null }) {
        const operation = this.operations.get(id);

        if (!operation || !['pending', 'processing'].includes(operation.status)) {
            return null;
        }

        operation.status = 'completed';
        operation.result = result ? { ...result } : null;
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = null;
        operation.completed_at = this.currentTime();
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async failOperation({ id, owner, error }) {
        const operation = this.operations.get(id);

        if (
            !operation
            || !['pending', 'processing'].includes(operation.status)
            || (operation.locked_by !== null && operation.locked_by !== owner)
        ) {
            return null;
        }

        operation.status = 'failed';
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = error && error.message ? error.message : String(error);
        operation.completed_at = this.currentTime();
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async deferOperation({ id, owner, error, delayMs = 0 }) {
        const operation = this.operations.get(id);

        if (!operation || operation.status !== 'processing' || operation.locked_by !== owner) {
            return null;
        }

        operation.status = 'pending';
        operation.locked_by = null;
        operation.locked_at = null;
        operation.next_attempt_at = new Date(this.currentTime().getTime() + Math.max(0, delayMs));
        operation.last_error = error && error.message ? error.message : String(error);
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async claimNextOperation({ workerId, leaseSeconds }) {
        const now = this.currentTime().getTime();
        const candidates = [...this.operations.values()]
            .filter((operation) => {
                if (operation.status === 'pending') {
                    return new Date(operation.next_attempt_at).getTime() <= now;
                }

                if (operation.status !== 'processing') {
                    return false;
                }

                const lockedAt = operation.locked_at ? new Date(operation.locked_at).getTime() : 0;
                return !lockedAt || (now - lockedAt) >= leaseSeconds * 1000;
            })
            .sort((a, b) => (
                new Date(a.next_attempt_at).getTime() - new Date(b.next_attempt_at).getTime()
                || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            ));

        const operation = candidates[0];

        if (!operation) {
            return null;
        }

        operation.status = 'processing';
        operation.attempts += 1;
        operation.locked_by = workerId;
        operation.locked_at = this.currentTime();
        operation.updated_at = this.currentTime();

        return cloneOperation(operation);
    }

    async rescheduleOperation({ id, workerId, error, delayMs }) {
        const operation = this.operations.get(id);

        if (!operation || operation.status !== 'processing' || operation.locked_by !== workerId) {
            return null;
        }

        const exhausted = operation.attempts >= operation.max_attempts;

        operation.status = exhausted ? 'failed' : 'pending';
        operation.next_attempt_at = exhausted
            ? operation.next_attempt_at
            : new Date(this.currentTime().getTime() + Math.max(0, delayMs));
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = error && error.message ? error.message : String(error);
        operation.completed_at = exhausted ? this.currentTime() : null;
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async markOperationCompleted({ id, workerId, result = null }) {
        const operation = this.operations.get(id);

        if (!operation || operation.status !== 'processing' || operation.locked_by !== workerId) {
            return null;
        }

        operation.status = 'completed';
        operation.result = result ? { ...result } : null;
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = null;
        operation.completed_at = this.currentTime();
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async markOperationFailed({ id, workerId, error }) {
        const operation = this.operations.get(id);

        if (!operation || operation.status !== 'processing' || operation.locked_by !== workerId) {
            return null;
        }

        operation.status = 'failed';
        operation.locked_by = null;
        operation.locked_at = null;
        operation.last_error = error && error.message ? error.message : String(error);
        operation.completed_at = this.currentTime();
        operation.updated_at = this.currentTime();
        return cloneOperation(operation);
    }

    async withTransaction(work) {
        const run = this.queue.then(async () => {
            const reservationsSnapshot = new Map(
                [...this.reservations.entries()].map(([key, value]) => [key, { ...value }])
            );
            const sessionsSnapshot = new Map(
                [...this.sessions.entries()].map(([key, value]) => [key, { ...value }])
            );
            const transaction = new FakeTransaction(this);
            this.transaction = transaction;

            try {
                const result = await work(transaction);
                transaction.operationChanges = [];
                return result;
            } catch (error) {
                this.reservations = reservationsSnapshot;
                this.sessions = sessionsSnapshot;

                for (const change of [...transaction.operationChanges].reverse()) {
                    this.operations.set(change.id, change.previous);
                }

                this.transaction = new FakeTransaction(this);
                throw error;
            }
        });

        this.queue = run.catch(() => {});
        return run;
    }
}

function spaceNotFound() {
    return new ParkingServiceError('not_found', 'La plaza solicitada no existe.');
}

function spaceConflict(message) {
    return new ParkingServiceError('conflict', message);
}

class FakeParkingClient {
    constructor({ currentTime = () => new Date() } = {}) {
        this.spaces = new Map();
        this.currentTime = currentTime;
        this.failGetSpace = null;
        this.failReserveSpace = null;
        this.failOccupySpace = null;
        this.failReleaseSpace = null;
        this.failCheckoutSpace = null;
        this.failRestoreSpace = null;
    }

    addSpace(id, overrides = {}) {
        this.spaces.set(id, {
            id,
            code: overrides.code || `S-${this.spaces.size + 1}`,
            level: overrides.level || '1',
            spaceType: overrides.spaceType || 'standard',
            status: overrides.status || 'available',
            reservedByReservationId: overrides.reservedByReservationId || null
        });
    }

    getSpace(id) {
        if (this.failGetSpace) {
            throw this.failGetSpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        return Promise.resolve({ ...space });
    }

    reserveSpace(id, reservationId) {
        if (this.failReserveSpace) {
            throw this.failReserveSpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        if (space.status === 'available') {
            space.status = 'reserved';
            space.reservedByReservationId = reservationId;
            return Promise.resolve({ ...space });
        }
        if (space.status === 'reserved' && space.reservedByReservationId === reservationId) {
            return Promise.resolve({ ...space });
        }
        throw spaceConflict('La plaza no está disponible para reservar.');
    }

    occupySpace(id, reservationId) {
        if (this.failOccupySpace) {
            throw this.failOccupySpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        if (space.status === 'reserved' && space.reservedByReservationId === reservationId) {
            space.status = 'occupied';
            return Promise.resolve({ ...space });
        }
        if (space.status === 'occupied' && space.reservedByReservationId === reservationId) {
            return Promise.resolve({ ...space });
        }
        throw spaceConflict('La plaza no puede pasar a ocupada.');
    }

    releaseSpace(id, reservationId) {
        if (this.failReleaseSpace) {
            throw this.failReleaseSpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        if (space.status === 'reserved' && space.reservedByReservationId === reservationId) {
            space.status = 'available';
            space.reservedByReservationId = null;
            return Promise.resolve({ ...space });
        }
        if (space.status === 'available') {
            return Promise.resolve({ ...space });
        }
        throw spaceConflict('La plaza no está reservada por esta reserva.');
    }

    checkoutSpace(id, reservationId) {
        if (this.failCheckoutSpace) {
            throw this.failCheckoutSpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        if (space.status === 'occupied' && space.reservedByReservationId === reservationId) {
            space.status = 'available';
            space.reservedByReservationId = null;
            return Promise.resolve({ ...space });
        }
        if (space.status === 'available') {
            return Promise.resolve({ ...space });
        }
        throw spaceConflict('La plaza no está ocupada por esta reserva.');
    }

    restoreSpace(id, reservationId) {
        if (this.failRestoreSpace) {
            throw this.failRestoreSpace;
        }
        const space = this.spaces.get(id);
        if (!space) {
            throw spaceNotFound();
        }
        if (space.status === 'occupied' && space.reservedByReservationId === reservationId) {
            space.status = 'reserved';
            return Promise.resolve({ ...space });
        }
        if (space.status === 'reserved' && space.reservedByReservationId === reservationId) {
            return Promise.resolve({ ...space });
        }
        throw spaceConflict('La plaza no puede volver al estado reservado.');
    }
}

module.exports = {
    FakeReservationRepository,
    FakeParkingClient,
    FakeTransaction
};
