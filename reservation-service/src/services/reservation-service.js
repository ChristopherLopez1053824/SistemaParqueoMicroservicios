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
    constructor({ repository, parkingClient, logger = console, now = () => new Date(), generateId = randomUUID }) {
        this.repository = repository;
        this.parkingClient = parkingClient;
        this.logger = logger;
        this.now = now;
        this.generateId = generateId;
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

        try {
            await this._reserveSpace(spaceId, reservationId, requestId);
        } catch (error) {
            throw this._mapParkingError(error, {
                notFoundMessage: 'La plaza indicada no existe.',
                conflictCode: ERROR_CODES.SPACE_NOT_AVAILABLE,
                conflictMessage: 'La plaza dejó de estar disponible antes de completar la reserva.'
            });
        }

        try {
            const row = await this.repository.withTransaction((transaction) => transaction.insertReservation({
                id: reservationId,
                spaceId,
                vehiclePlate
            }));
            return serializeReservation(row);
        } catch (error) {
            try {
                await this._releaseReservedSpace(spaceId, reservationId, requestId);
            } catch (compensationError) {
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

        return this.repository.withTransaction(async (transaction) => {
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

            try {
                await this._releaseReservedSpace(reservation.space_id, id, requestId);
            } catch (error) {
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

            return serializeReservation(updated);
        });
    }

    async registerEntry(reservationId, { requestId }) {
        assertUuid(reservationId, 'reservationId');

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

                try {
                    await this._occupySpace(spaceId, reservationId, requestId);
                    occupancyApplied = true;
                } catch (error) {
                    throw this._mapParkingError(error, {
                        conflictCode: ERROR_CODES.INVALID_STATE_TRANSITION,
                        conflictMessage: 'La plaza no está reservada por esta reserva o no puede pasar a ocupada.'
                    });
                }

                let session;
                try {
                    session = await transaction.insertSession({
                        id: this.generateId(),
                        reservationId,
                        spaceId,
                        vehiclePlate: reservation.vehicle_plate,
                        entryAt: this.now()
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

                return serializeSession(session);
            });
        } catch (error) {
            if (occupancyApplied && spaceId) {
                try {
                    await this._restoreOccupiedSpace(spaceId, reservationId, requestId);
                } catch (compensationError) {
                    this.logger.error(
                        `[${requestId}] No se pudo restaurar la plaza ${spaceId} después de fallar la entrada de la reserva ${reservationId}: ${compensationError.message}`
                    );
                    throw serviceUnavailable(
                        'La entrada no pudo completarse y la plaza requiere reconciliación.',
                        { cause: error }
                    );
                }
            }

            throw error;
        }
    }

    async registerExit(sessionId, { requestId }) {
        assertUuid(sessionId, 'sessionId');

        return this.repository.withTransaction(async (transaction) => {
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

            try {
                await this._checkoutSpace(session.space_id, session.reservation_id, requestId);
            } catch (error) {
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

            return serializeSession(completedSession);
        });
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
