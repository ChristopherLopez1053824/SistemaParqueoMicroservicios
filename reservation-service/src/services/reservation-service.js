const { randomUUID } = require('crypto');
const {
    AppError,
    ERROR_CODES,
    notFound,
    conflict,
    serviceUnavailable
} = require('../lib/errors');
const { assertUuid, validateCreateReservation } = require('../lib/validation');
const { serializeReservation, serializeSession } = require('../lib/serializers');
const { ParkingServiceError } = require('../http/parking-client');

function isUncertain(error) {
    return error instanceof ParkingServiceError
        && ['timeout', 'unavailable', 'server', 'bad_response'].includes(error.kind);
}

class ReservationService {
    constructor({
        repository,
        parkingClient,
        logger = console,
        now = () => new Date(),
        generateId = randomUUID,
        operationOwnerId = `api:${process.pid}:${randomUUID()}`,
        reconciliationMaxAttempts = 10,
        reconciliationRetryBaseMs = 1000
    }) {
        this.repository = repository;
        this.parkingClient = parkingClient;
        this.logger = logger;
        this.now = now;
        this.generateId = generateId;
        this.operationOwnerId = operationOwnerId;
        this.reconciliationMaxAttempts = reconciliationMaxAttempts;
        this.reconciliationRetryBaseMs = reconciliationRetryBaseMs;
    }

    async _startOperation({
        operationType,
        reservationId = null,
        sessionId = null,
        spaceId = null,
        requestId = null,
        payload = {}
    }) {
        try {
            return await this.repository.createOperation({
                id: this.generateId(),
                operationType,
                reservationId,
                sessionId,
                spaceId,
                requestId,
                payload,
                owner: this.operationOwnerId,
                maxAttempts: this.reconciliationMaxAttempts
            });
        } catch (error) {
            if (error && error.code === 'RECONCILIATION_OPERATION_BUSY') {
                throw conflict(
                    ERROR_CODES.RECONCILIATION_IN_PROGRESS,
                    'Ya existe una operación en curso para este recurso. Intenta nuevamente en unos segundos.'
                );
            }
            throw error;
        }
    }

    async _failOperation(operationId, error) {
        if (!operationId) {
            return;
        }

        try {
            await this.repository.failOperation({
                id: operationId,
                owner: this.operationOwnerId,
                error
            });
        } catch (operationError) {
            this.logger.error(
                `No se pudo marcar como fallida la operación ${operationId}: ${operationError.message}`
            );
        }
    }

    async _deferOperation(operationId, error, delayMs = this.reconciliationRetryBaseMs) {
        if (!operationId) {
            return;
        }

        try {
            await this.repository.deferOperation({
                id: operationId,
                owner: this.operationOwnerId,
                error,
                delayMs
            });
        } catch (operationError) {
            this.logger.error(
                `No se pudo reprogramar la operación ${operationId}: ${operationError.message}`
            );
        }
    }

    async _completeStandaloneOperation(operationId, result = null) {
        if (!operationId) {
            return;
        }

        try {
            await this.repository.completeOperation({ id: operationId, result });
        } catch (error) {
            this.logger.error(
                `No se pudo completar la operación ${operationId}: ${error.message}`
            );
        }
    }

    _mapParkingError(error, { notFoundMessage, conflictCode, conflictMessage }) {
        if (!(error instanceof ParkingServiceError)) {
            return error;
        }

        if (error.kind === 'not_found') {
            return notFound(notFoundMessage || 'La plaza indicada no existe.');
        }

        if (error.kind === 'conflict') {
            return conflict(
                conflictCode || ERROR_CODES.RESERVATION_CONFLICT,
                conflictMessage || 'La operación no es válida para el estado actual de la plaza.'
            );
        }

        if (error.kind === 'timeout') {
            return new AppError(
                504,
                ERROR_CODES.SERVICE_UNAVAILABLE,
                'Parking Service no respondió dentro del tiempo esperado.',
                null,
                { cause: error }
            );
        }

        if (error.kind === 'bad_response') {
            return new AppError(
                502,
                ERROR_CODES.SERVICE_UNAVAILABLE,
                'Parking Service devolvió una respuesta inválida.',
                null,
                { cause: error }
            );
        }

        return serviceUnavailable('Parking Service no está disponible en este momento.', { cause: error });
    }

    async _parkingOperation({ operation, spaceId, requestId, appliedWhen, retryWhen }) {
        try {
            return await operation();
        } catch (error) {
            if (!isUncertain(error)) {
                throw error;
            }

            let currentSpace;
            try {
                currentSpace = await this.parkingClient.getSpace(spaceId, requestId);
            } catch (lookupError) {
                throw error;
            }

            if (appliedWhen(currentSpace)) {
                return currentSpace;
            }

            if (retryWhen && retryWhen(currentSpace)) {
                try {
                    return await operation();
                } catch (retryError) {
                    throw retryError;
                }
            }

            throw error;
        }
    }

    _reserveSpace(spaceId, reservationId, requestId) {
        return this._parkingOperation({
            operation: () => this.parkingClient.reserveSpace(spaceId, reservationId, requestId),
            spaceId,
            requestId,
            appliedWhen: (space) => space.status === 'reserved' && space.reservedByReservationId === reservationId,
            retryWhen: (space) => space.status === 'available'
        });
    }

    _occupySpace(spaceId, reservationId, requestId) {
        return this._parkingOperation({
            operation: () => this.parkingClient.occupySpace(spaceId, reservationId, requestId),
            spaceId,
            requestId,
            appliedWhen: (space) => space.status === 'occupied' && space.reservedByReservationId === reservationId,
            retryWhen: (space) => space.status === 'reserved' && space.reservedByReservationId === reservationId
        });
    }

    _releaseReservedSpace(spaceId, reservationId, requestId) {
        return this._parkingOperation({
            operation: () => this.parkingClient.releaseSpace(spaceId, reservationId, requestId),
            spaceId,
            requestId,
            appliedWhen: (space) => space.status === 'available',
            retryWhen: (space) => space.status === 'reserved' && space.reservedByReservationId === reservationId
        });
    }

    _checkoutSpace(spaceId, reservationId, requestId) {
        return this._parkingOperation({
            operation: () => this.parkingClient.checkoutSpace(spaceId, reservationId, requestId),
            spaceId,
            requestId,
            appliedWhen: (space) => space.status === 'available',
            retryWhen: (space) => space.status === 'occupied' && space.reservedByReservationId === reservationId
        });
    }

    _restoreOccupiedSpace(spaceId, reservationId, requestId) {
        return this._parkingOperation({
            operation: () => this.parkingClient.restoreSpace(spaceId, reservationId, requestId),
            spaceId,
            requestId,
            appliedWhen: (space) => space.status === 'reserved' && space.reservedByReservationId === reservationId,
            retryWhen: (space) => space.status === 'occupied' && space.reservedByReservationId === reservationId
        });
    }

    async createReservation(input, { requestId }) {
        const { spaceId, vehiclePlate } = validateCreateReservation(input);

        let space;
        try {
            space = await this.parkingClient.getSpace(spaceId, requestId);
        } catch (error) {
            throw this._mapParkingError(error, {
                notFoundMessage: 'La plaza indicada no existe.'
            });
        }

        if (!space || typeof space.status !== 'string') {
            throw new AppError(
                502,
                ERROR_CODES.SERVICE_UNAVAILABLE,
                'Parking Service devolvió datos de plaza incompletos.'
            );
        }

        if (space.status !== 'available') {
            throw conflict(
                ERROR_CODES.SPACE_NOT_AVAILABLE,
                `La plaza no está disponible para reservar (estado actual: ${space.status}).`
            );
        }

        const reservationId = this.generateId();
        const operation = await this._startOperation({
            operationType: 'reserve_space',
            reservationId,
            spaceId,
            requestId,
            payload: { reservationId, spaceId, vehiclePlate }
        });
        const operationId = operation.id;

        try {
            await this._reserveSpace(spaceId, reservationId, requestId);
        } catch (error) {
            if (isUncertain(error)) {
                await this._deferOperation(operationId, error);
            } else {
                await this._failOperation(operationId, error);
            }

            throw this._mapParkingError(error, {
                notFoundMessage: 'La plaza indicada no existe.',
                conflictCode: ERROR_CODES.SPACE_NOT_AVAILABLE,
                conflictMessage: 'La plaza dejó de estar disponible antes de completar la reserva.'
            });
        }

        try {
            const row = await this.repository.withTransaction(async (transaction) => {
                const inserted = await transaction.insertReservation({
                    id: reservationId,
                    spaceId,
                    vehiclePlate
                });

                await transaction.completeOperation({
                    id: operationId,
                    result: { status: 'confirmed' }
                });

                return inserted;
            });
            return serializeReservation(row);
        } catch (error) {
            await this._failOperation(operationId, error);

            let releaseOperationId = null;
            try {
                const releaseOperation = await this._startOperation({
                    operationType: 'release_space',
                    reservationId,
                    spaceId,
                    requestId,
                    payload: { purpose: 'reservation-creation-compensation' }
                });
                releaseOperationId = releaseOperation.id;
            } catch (operationError) {
                this.logger.error(
                    `[${requestId}] No se pudo registrar la compensación de la plaza ${spaceId}: ${operationError.message}`
                );
            }

            try {
                await this._releaseReservedSpace(spaceId, reservationId, requestId);
                await this._completeStandaloneOperation(releaseOperationId);
            } catch (compensationError) {
                if (releaseOperationId) {
                    await this._deferOperation(releaseOperationId, compensationError);
                }

                this.logger.error(
                    `[${requestId}] No se pudo liberar la plaza ${spaceId} después de fallar la creación de la reserva ${reservationId}: ${compensationError.message}`
                );
                throw serviceUnavailable(
                    'La reserva no pudo completarse y la plaza requiere reconciliación.',
                    { cause: error }
                );
            }

            if (error && error.code === '23505') {
                throw conflict(
                    ERROR_CODES.RESERVATION_CONFLICT,
                    'Ya existe una reserva activa para esa plaza.',
                    null
                );
            }

            throw error;
        }
    }

    async listReservations() {
        const rows = await this.repository.listReservations();
        return rows.map(serializeReservation);
    }

    async getReservation(id) {
        assertUuid(id, 'id');
        const row = await this.repository.findReservationById(id);

        if (!row) {
            throw notFound('La reserva solicitada no existe.');
        }

        return serializeReservation(row);
    }

    async cancelReservation(id, { requestId }) {
        assertUuid(id, 'id');

        let operationId = null;
        let handled = false;

        try {
            return await this.repository.withTransaction(async (transaction) => {
                const reservation = await transaction.lockReservation(id);

                if (!reservation) {
                    throw notFound('La reserva solicitada no existe.');
                }

                if (reservation.status !== 'confirmed') {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        `La reserva no puede cancelarse porque su estado actual es ${reservation.status}.`
                    );
                }

                const activeSession = await transaction.findActiveSessionByReservationId(id);

                if (activeSession) {
                    throw conflict(
                        ERROR_CODES.RESERVATION_CONFLICT,
                        'La reserva tiene una sesión activa y no puede cancelarse de forma segura.'
                    );
                }

                const operation = await this._startOperation({
                    operationType: 'cancel_reservation',
                    reservationId: id,
                    spaceId: reservation.space_id,
                    requestId,
                    payload: { reservationId: id }
                });
                operationId = operation.id;

                try {
                    await this._releaseReservedSpace(reservation.space_id, id, requestId);
                } catch (error) {
                    if (isUncertain(error)) {
                        await this._deferOperation(operationId, error);
                    } else {
                        await this._failOperation(operationId, error);
                    }
                    handled = true;

                    throw this._mapParkingError(error, {
                        conflictCode: ERROR_CODES.INVALID_STATE_TRANSITION,
                        conflictMessage: 'La plaza no puede liberarse porque no está reservada por esta reserva.'
                    });
                }

                const updated = await transaction.updateReservationStatus(id, ['confirmed'], 'cancelled');

                if (!updated) {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        'La reserva cambió de estado durante la operación.'
                    );
                }

                await transaction.completeOperation({
                    id: operationId,
                    result: { status: 'cancelled' }
                });

                return serializeReservation(updated);
            });
        } catch (error) {
            if (operationId && !handled) {
                await this._deferOperation(operationId, error);
            }
            throw error;
        }
    }

    async registerEntry(reservationId, { requestId }) {
        assertUuid(reservationId, 'reservationId');

        let operationId = null;
        let handled = false;
        let occupancyApplied = false;
        let spaceId = null;

        try {
            return await this.repository.withTransaction(async (transaction) => {
                const reservation = await transaction.lockReservation(reservationId);

                if (!reservation) {
                    throw notFound('La reserva solicitada no existe.');
                }

                if (reservation.status !== 'confirmed') {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        `No se puede registrar la entrada de una reserva en estado ${reservation.status}.`
                    );
                }

                const activeSession = await transaction.findActiveSessionByReservationId(reservationId);

                if (activeSession) {
                    throw conflict(
                        ERROR_CODES.RESERVATION_CONFLICT,
                        'La reserva ya tiene una sesión activa.'
                    );
                }

                spaceId = reservation.space_id;
                const sessionId = this.generateId();
                const entryAt = this.now();
                const operation = await this._startOperation({
                    operationType: 'occupy_space',
                    reservationId,
                    sessionId,
                    spaceId,
                    requestId,
                    payload: {
                        sessionId,
                        reservationId,
                        spaceId,
                        vehiclePlate: reservation.vehicle_plate,
                        entryAt: entryAt.toISOString()
                    }
                });
                operationId = operation.id;

                try {
                    await this._occupySpace(spaceId, reservationId, requestId);
                    occupancyApplied = true;
                } catch (error) {
                    if (isUncertain(error)) {
                        await this._deferOperation(operationId, error);
                    } else {
                        await this._failOperation(operationId, error);
                    }
                    handled = true;

                    throw this._mapParkingError(error, {
                        conflictCode: ERROR_CODES.INVALID_STATE_TRANSITION,
                        conflictMessage: 'La plaza no está reservada por esta reserva o no puede pasar a ocupada.'
                    });
                }

                let session;
                try {
                    session = await transaction.insertSession({
                        id: sessionId,
                        reservationId,
                        spaceId,
                        vehiclePlate: reservation.vehicle_plate,
                        entryAt
                    });
                } catch (error) {
                    if (error && error.code === '23505') {
                        throw conflict(
                            ERROR_CODES.RESERVATION_CONFLICT,
                            'La reserva ya tiene una sesión activa.'
                        );
                    }
                    throw error;
                }

                await transaction.completeOperation({
                    id: operationId,
                    result: { sessionId, status: 'active' }
                });

                return serializeSession(session);
            });
        } catch (error) {
            if (occupancyApplied && spaceId && operationId) {
                await this._failOperation(operationId, error);

                let restoreOperationId = null;
                try {
                    const restoreOperation = await this._startOperation({
                        operationType: 'restore_space',
                        reservationId,
                        spaceId,
                        requestId,
                        payload: { purpose: 'entry-compensation' }
                    });
                    restoreOperationId = restoreOperation.id;
                } catch (operationError) {
                    this.logger.error(
                        `[${requestId}] No se pudo registrar la restauración de la plaza ${spaceId}: ${operationError.message}`
                    );
                }

                try {
                    await this._restoreOccupiedSpace(spaceId, reservationId, requestId);
                    await this._completeStandaloneOperation(restoreOperationId);
                } catch (compensationError) {
                    if (restoreOperationId) {
                        await this._deferOperation(restoreOperationId, compensationError);
                    }

                    this.logger.error(
                        `[${requestId}] No se pudo restaurar la plaza ${spaceId} después de fallar la entrada de la reserva ${reservationId}: ${compensationError.message}`
                    );
                    throw serviceUnavailable(
                        'La entrada no pudo completarse y la plaza requiere reconciliación.',
                        { cause: error }
                    );
                }
            } else if (operationId && !handled) {
                await this._deferOperation(operationId, error);
            }

            throw error;
        }
    }

    async registerExit(sessionId, { requestId }) {
        assertUuid(sessionId, 'sessionId');

        let operationId = null;
        let handled = false;

        try {
            return await this.repository.withTransaction(async (transaction) => {
                const snapshot = await transaction.findSessionById(sessionId);

                if (!snapshot) {
                    throw notFound('La sesión solicitada no existe.');
                }

                const reservation = await transaction.lockReservation(snapshot.reservation_id);
                const session = await transaction.lockSession(sessionId);

                if (!session) {
                    throw notFound('La sesión solicitada no existe.');
                }

                if (session.status === 'completed') {
                    throw conflict(
                        ERROR_CODES.SESSION_ALREADY_COMPLETED,
                        'La sesión ya fue finalizada.'
                    );
                }

                if (session.status !== 'active') {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        `No se puede finalizar una sesión en estado ${session.status}.`
                    );
                }

                if (!reservation) {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        'La reserva asociada a la sesión no existe.'
                    );
                }

                if (reservation.status === 'cancelled') {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        'No se puede finalizar una sesión asociada a una reserva cancelada.'
                    );
                }

                const exitAt = this.now();
                const entryTime = new Date(session.entry_at).getTime();
                const exitTime = exitAt.getTime();
                const durationSeconds = Math.max(0, Math.floor((exitTime - entryTime) / 1000));

                const operation = await this._startOperation({
                    operationType: 'checkout_space',
                    reservationId: session.reservation_id,
                    sessionId,
                    spaceId: session.space_id,
                    requestId,
                    payload: {
                        sessionId,
                        reservationId: session.reservation_id,
                        spaceId: session.space_id,
                        exitAt: exitAt.toISOString(),
                        durationSeconds
                    }
                });
                operationId = operation.id;

                try {
                    await this._checkoutSpace(session.space_id, session.reservation_id, requestId);
                } catch (error) {
                    if (isUncertain(error)) {
                        await this._deferOperation(operationId, error);
                    } else {
                        await this._failOperation(operationId, error);
                    }
                    handled = true;

                    throw this._mapParkingError(error, {
                        conflictCode: ERROR_CODES.INVALID_STATE_TRANSITION,
                        conflictMessage: 'La plaza no pudo liberarse porque no está ocupada por esta reserva.'
                    });
                }

                const completedSession = await transaction.completeSession({
                    sessionId,
                    exitAt,
                    durationSeconds
                });

                if (!completedSession) {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        'La sesión cambió de estado durante la operación.'
                    );
                }

                const completedReservation = await transaction.completeReservation(session.reservation_id);

                if (!completedReservation) {
                    throw conflict(
                        ERROR_CODES.INVALID_STATE_TRANSITION,
                        'No se pudo completar la reserva asociada a la sesión.'
                    );
                }

                await transaction.completeOperation({
                    id: operationId,
                    result: {
                        sessionId,
                        status: 'completed',
                        durationSeconds
                    }
                });

                return serializeSession(completedSession);
            });
        } catch (error) {
            if (operationId && !handled) {
                await this._deferOperation(operationId, error);
            }
            throw error;
        }
    }

    async getSession(sessionId) {
        assertUuid(sessionId, 'sessionId');
        const row = await this.repository.findSessionById(sessionId);

        if (!row) {
            throw notFound('La sesión solicitada no existe.');
        }

        return serializeSession(row);
    }
}

module.exports = {
    ReservationService
};
