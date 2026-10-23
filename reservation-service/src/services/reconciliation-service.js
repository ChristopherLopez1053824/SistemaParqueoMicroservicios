const { randomUUID } = require('crypto');
const { ParkingServiceError } = require('../http/parking-client');

class NonRetryableError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'NonRetryableError';
        this.nonRetryable = true;
        if (options.cause) {
            this.cause = options.cause;
        }
    }
}

function isNonRetryable(error) {
    if (error instanceof NonRetryableError || error?.nonRetryable) {
        return true;
    }

    return error instanceof ParkingServiceError
        && ['not_found', 'conflict'].includes(error.kind);
}

function ownsSpace(space, reservationId) {
    return space
        && space.reservedByReservationId === reservationId;
}

function delayForAttempt(attempts, baseMs, maxMs) {
    const exponent = Math.min(Math.max(0, attempts - 1), 20);
    return Math.min(maxMs, baseMs * (2 ** exponent));
}

class ReconciliationService {
    constructor({
        repository,
        parkingClient,
        logger = console,
        workerId = `reconciliation:${randomUUID()}`,
        pollIntervalMs = 2000,
        leaseSeconds = 60,
        retryBaseMs = 1000,
        retryMaxMs = 60000,
        maxAttempts = 10
    }) {
        this.repository = repository;
        this.parkingClient = parkingClient;
        this.logger = logger;
        this.workerId = workerId;
        this.pollIntervalMs = pollIntervalMs;
        this.leaseSeconds = leaseSeconds;
        this.retryBaseMs = retryBaseMs;
        this.retryMaxMs = retryMaxMs;
        this.maxAttempts = maxAttempts;
        this.running = false;
        this.loopPromise = null;
        this.sleepTimer = null;
        this.wakeUp = null;
    }

    async runOnce() {
        const operation = await this.repository.claimNextOperation({
            workerId: this.workerId,
            leaseSeconds: this.leaseSeconds
        });

        if (!operation) {
            return false;
        }

        await this.processOperation(operation);
        return true;
    }

    async processOperation(operation) {
        if (operation.attempts > (operation.max_attempts || this.maxAttempts)) {
            await this.repository.markOperationFailed({
                id: operation.id,
                workerId: this.workerId,
                error: 'Se agotaron los intentos de reconciliación.'
            });
            return;
        }

        try {
            await this._reconcile(operation);

            await this.repository.markOperationCompleted({
                id: operation.id,
                workerId: this.workerId,
                result: { reconciledAt: new Date().toISOString() }
            });
        } catch (error) {
            if (isNonRetryable(error)) {
                this.logger.error(
                    `[reconciliation:${operation.id}] Operación ${operation.operation_type} descartada: ${error.message}`
                );
                await this.repository.markOperationFailed({
                    id: operation.id,
                    workerId: this.workerId,
                    error
                });
                return;
            }

            const retryDelayMs = delayForAttempt(
                operation.attempts,
                this.retryBaseMs,
                this.retryMaxMs
            );

            this.logger.error(
                `[reconciliation:${operation.id}] Falló ${operation.operation_type}; reintento en ${retryDelayMs} ms: ${error.message}`
            );

            await this.repository.rescheduleOperation({
                id: operation.id,
                workerId: this.workerId,
                error,
                delayMs: retryDelayMs
            });
        }
    }

    async start() {
        if (this.running) {
            return;
        }

        this.running = true;
        this.loopPromise = this._runLoop();
    }

    async stop() {
        this.running = false;
        this._wake();
        await this.loopPromise;
        this.loopPromise = null;
    }

    async _runLoop() {
        while (this.running) {
            try {
                const processed = await this.runOnce();
                if (!processed) {
                    await this._sleep(this.pollIntervalMs);
                }
            } catch (error) {
                this.logger.error(`Error inesperado en el worker de reconciliación: ${error.message}`);
                await this._sleep(this.pollIntervalMs);
            }
        }
    }

    _sleep(milliseconds) {
        return new Promise((resolve) => {
            this.wakeUp = resolve;
            this.sleepTimer = setTimeout(() => {
                this.sleepTimer = null;
                this.wakeUp = null;
                resolve();
            }, milliseconds);
        });
    }

    _wake() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
        }
        if (this.wakeUp) {
            const resolve = this.wakeUp;
            this.wakeUp = null;
            resolve();
        }
    }

    async _getSpace(operation) {
        if (!operation.space_id) {
            throw new NonRetryableError('La operación no tiene una plaza asociada.');
        }

        return this.parkingClient.getSpace(operation.space_id, operation.request_id || undefined);
    }

    async _reconcile(operation) {
        switch (operation.operation_type) {
            case 'reserve_space':
                return this._reconcileReservation(operation);
            case 'cancel_reservation':
                return this._reconcileCancellation(operation);
            case 'occupy_space':
                return this._reconcileEntry(operation);
            case 'checkout_space':
                return this._reconcileExit(operation);
            case 'release_space':
                return this._reconcileRelease(operation);
            case 'restore_space':
                return this._reconcileRestore(operation);
            default:
                throw new NonRetryableError(`Tipo de operación desconocido: ${operation.operation_type}.`);
        }
    }

    async _reconcileReservation(operation) {
        const payload = operation.payload || {};
        const reservationId = operation.reservation_id;
        const spaceId = operation.space_id;
        const vehiclePlate = payload.vehiclePlate;

        if (!reservationId || !spaceId || !vehiclePlate) {
            throw new NonRetryableError('La operación de reserva no contiene todos los datos necesarios.');
        }

        const [reservation, space] = await Promise.all([
            this.repository.findReservationById(reservationId),
            this._getSpace(operation)
        ]);

        if (reservation && reservation.status !== 'confirmed') {
            if (space.status === 'reserved' && ownsSpace(space, reservationId)) {
                await this.parkingClient.releaseSpace(spaceId, reservationId, operation.request_id || undefined);
            }
            throw new NonRetryableError(`La reserva ya está en estado ${reservation.status}.`);
        }

        if (space.status === 'available') {
            await this.parkingClient.reserveSpace(spaceId, reservationId, operation.request_id || undefined);
        } else if (!ownsSpace(space, reservationId) || !['reserved', 'occupied'].includes(space.status)) {
            throw new NonRetryableError(`La plaza ${spaceId} no está disponible ni pertenece a la reserva.`);
        }

        if (reservation) {
            return;
        }

        try {
            await this.repository.withTransaction(async (transaction) => {
                await transaction.insertReservation({
                    id: reservationId,
                    spaceId,
                    vehiclePlate
                });
                await transaction.completeOperation({ id: operation.id });
            });
        } catch (error) {
            if (error && error.code === '23505') {
                throw new NonRetryableError('Ya existe otra reserva confirmada para la plaza.', { cause: error });
            }
            throw error;
        }
    }

    async _reconcileCancellation(operation) {
        const reservationId = operation.reservation_id;

        if (!reservationId) {
            throw new NonRetryableError('La operación de cancelación no tiene una reserva asociada.');
        }

        await this.repository.withTransaction(async (transaction) => {
            const reservation = await transaction.lockReservation(reservationId);

            if (!reservation) {
                throw new NonRetryableError('La reserva a cancelar no existe.');
            }

            if (reservation.status === 'cancelled') {
                await transaction.completeOperation({ id: operation.id });
                return;
            }

            if (reservation.status !== 'confirmed') {
                throw new NonRetryableError(`La reserva está en estado ${reservation.status}.`);
            }

            const activeSession = await transaction.findActiveSessionByReservationId(reservationId);

            if (activeSession) {
                throw new NonRetryableError('La reserva tiene una sesión activa.');
            }

            const space = await this._getSpace(operation);

            if (space.status === 'reserved' && ownsSpace(space, reservationId)) {
                await this.parkingClient.releaseSpace(
                    operation.space_id,
                    reservationId,
                    operation.request_id || undefined
                );
            } else if (space.status !== 'available') {
                throw new NonRetryableError('La plaza no está reservada por esta reserva.');
            }

            const updated = await transaction.updateReservationStatus(
                reservationId,
                ['confirmed'],
                'cancelled'
            );

            if (!updated) {
                throw new Error('La reserva cambió de estado durante la reconciliación.');
            }

            await transaction.completeOperation({ id: operation.id });
        });
    }

    async _reconcileEntry(operation) {
        const payload = operation.payload || {};
        const reservationId = operation.reservation_id;
        const sessionId = operation.session_id;

        if (!reservationId || !sessionId) {
            throw new NonRetryableError('La operación de entrada no contiene reserva y sesión.');
        }

        await this.repository.withTransaction(async (transaction) => {
            const existingSession = await transaction.findSessionById(sessionId);
            const reservation = await transaction.lockReservation(reservationId);

            if (!reservation) {
                throw new NonRetryableError('La reserva de la entrada no existe.');
            }

            if (existingSession && existingSession.status !== 'active') {
                throw new NonRetryableError(`La sesión está en estado ${existingSession.status}.`);
            }

            const activeSession = await transaction.findActiveSessionByReservationId(reservationId);

            if (activeSession && activeSession.id !== sessionId) {
                throw new NonRetryableError('La reserva ya tiene otra sesión activa.');
            }

            if (reservation.status !== 'confirmed') {
                throw new NonRetryableError(`La reserva está en estado ${reservation.status}.`);
            }

            const space = await this._getSpace(operation);

            if (space.status === 'reserved' && ownsSpace(space, reservationId)) {
                await this.parkingClient.occupySpace(
                    operation.space_id,
                    reservationId,
                    operation.request_id || undefined
                );
            } else if (!(space.status === 'occupied' && ownsSpace(space, reservationId))) {
                throw new NonRetryableError('La plaza no puede pasar a ocupada.');
            }

            if (existingSession) {
                await transaction.completeOperation({ id: operation.id });
                return;
            }

            const entryAt = payload.entryAt ? new Date(payload.entryAt) : new Date();

            if (Number.isNaN(entryAt.getTime())) {
                throw new NonRetryableError('La operación de entrada no contiene una fecha válida.');
            }

            try {
                await transaction.insertSession({
                    id: sessionId,
                    reservationId,
                    spaceId: operation.space_id,
                    vehiclePlate: payload.vehiclePlate || reservation.vehicle_plate,
                    entryAt
                });
            } catch (error) {
                if (error && error.code === '23505') {
                    throw new NonRetryableError('La reserva ya tiene una sesión activa.', { cause: error });
                }
                throw error;
            }

            await transaction.completeOperation({ id: operation.id });
        });
    }

    async _reconcileExit(operation) {
        const payload = operation.payload || {};
        const sessionId = operation.session_id;

        if (!sessionId) {
            throw new NonRetryableError('La operación de salida no tiene una sesión asociada.');
        }

        await this.repository.withTransaction(async (transaction) => {
            const snapshot = await transaction.findSessionById(sessionId);

            if (!snapshot) {
                throw new NonRetryableError('La sesión a finalizar no existe.');
            }

            const reservation = await transaction.lockReservation(snapshot.reservation_id);
            const session = await transaction.lockSession(sessionId);

            if (!session) {
                throw new NonRetryableError('La sesión a finalizar no existe.');
            }

            if (session.status === 'completed') {
                await transaction.completeOperation({ id: operation.id });
                return;
            }

            if (session.status !== 'active') {
                throw new NonRetryableError(`La sesión está en estado ${session.status}.`);
            }

            if (!reservation) {
                throw new NonRetryableError('La reserva de la sesión no existe.');
            }

            if (reservation.status === 'cancelled') {
                throw new NonRetryableError('La reserva de la sesión está cancelada.');
            }

            const space = await this._getSpace(operation);

            if (space.status === 'occupied' && ownsSpace(space, reservation.id)) {
                await this.parkingClient.checkoutSpace(
                    session.space_id,
                    reservation.id,
                    operation.request_id || undefined
                );
            } else if (space.status !== 'available') {
                throw new NonRetryableError('La plaza no está ocupada por esta reserva.');
            }

            const exitAt = payload.exitAt ? new Date(payload.exitAt) : new Date();

            if (Number.isNaN(exitAt.getTime())) {
                throw new NonRetryableError('La operación de salida no contiene una fecha válida.');
            }

            const entryTime = new Date(session.entry_at).getTime();
            const durationSeconds = Number.isInteger(payload.durationSeconds)
                ? Math.max(0, payload.durationSeconds)
                : Math.max(0, Math.floor((exitAt.getTime() - entryTime) / 1000));

            const completedSession = await transaction.completeSession({
                sessionId,
                exitAt,
                durationSeconds
            });

            if (!completedSession) {
                throw new Error('La sesión cambió de estado durante la reconciliación.');
            }

            const completedReservation = await transaction.completeReservation(reservation.id);

            if (!completedReservation) {
                throw new Error('No se pudo completar la reserva durante la reconciliación.');
            }

            await transaction.completeOperation({ id: operation.id });
        });
    }

    async _reconcileRelease(operation) {
        const space = await this._getSpace(operation);
        const reservationId = operation.reservation_id;

        if (space.status === 'reserved' && ownsSpace(space, reservationId)) {
            await this.parkingClient.releaseSpace(
                operation.space_id,
                reservationId,
                operation.request_id || undefined
            );
            return;
        }

        if (space.status !== 'available') {
            throw new NonRetryableError('La plaza no puede liberarse en su estado actual.');
        }
    }

    async _reconcileRestore(operation) {
        const space = await this._getSpace(operation);
        const reservationId = operation.reservation_id;

        if (space.status === 'occupied' && ownsSpace(space, reservationId)) {
            await this.parkingClient.restoreSpace(
                operation.space_id,
                reservationId,
                operation.request_id || undefined
            );
            return;
        }

        if (!(space.status === 'reserved' && ownsSpace(space, reservationId))) {
            throw new NonRetryableError('La plaza no puede volver al estado reservado.');
        }
    }
}

module.exports = {
    ReconciliationService,
    NonRetryableError
};
