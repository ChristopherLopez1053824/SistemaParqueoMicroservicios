const { ParkingServiceError } = require('../../src/http/parking-client');

function cloneRow(row) {
    if (!row) {
        return null;
    }
    return { ...row };
}

class FakeTransaction {
    constructor(repository) {
        this.repository = repository;
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
}

class FakeReservationRepository {
    constructor({ currentTime = () => new Date() } = {}) {
        this.reservations = new Map();
        this.sessions = new Map();
        this.currentTime = currentTime;
        this.transaction = new FakeTransaction(this);
        this.queue = Promise.resolve();
        this.failInsertReservation = false;
        this.failInsertSession = false;
        this.failCompleteSession = false;
    }

    async listReservations() {
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

    async withTransaction(work) {
        const run = this.queue.then(async () => {
            const reservationsSnapshot = new Map(
                [...this.reservations.entries()].map(([key, value]) => [key, { ...value }])
            );
            const sessionsSnapshot = new Map(
                [...this.sessions.entries()].map(([key, value]) => [key, { ...value }])
            );

            try {
                return await work(this.transaction);
            } catch (error) {
                this.reservations = reservationsSnapshot;
                this.sessions = sessionsSnapshot;
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
