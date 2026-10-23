const { query } = require('../lib/query');
const { AppError, CODES } = require('../lib/errors');
const { ALLOWED_TRANSITIONS } = require('../lib/constants');

const SPACE_COLUMNS = 'id, code, level, space_type, status, reserved_by_reservation_id, created_at, updated_at';

function sourceStatusesFor(nextStatus) {
    return Object.entries(ALLOWED_TRANSITIONS)
        .filter(([, targets]) => targets.includes(nextStatus))
        .map(([status]) => status);
}

function transitionError(currentStatus, nextStatus) {
    const details = [
        {
            field: 'status',
            message: `No se permite cambiar el estado de "${currentStatus}" a "${nextStatus}".`
        }
    ];

    if (nextStatus === 'reserved') {
        return new AppError(
            409,
            CODES.SPACE_NOT_AVAILABLE,
            'La plaza no está disponible para reservarse.',
            details
        );
    }

    if (nextStatus === 'occupied' && currentStatus === 'maintenance') {
        return new AppError(
            409,
            CODES.SPACE_NOT_AVAILABLE,
            'Una plaza en mantenimiento no puede ocuparse.',
            details
        );
    }

    return new AppError(
        409,
        CODES.INVALID_STATE_TRANSITION,
        'La transición de estado solicitada no es válida.',
        details
    );
}

async function listSpaces() {
    const result = await query(
        `SELECT ${SPACE_COLUMNS}
         FROM parking.parking_spaces
         ORDER BY code`
    );

    return result.rows;
}

async function findSpaceById(id) {
    const result = await query(
        `SELECT ${SPACE_COLUMNS}
         FROM parking.parking_spaces
         WHERE id = $1`,
        [id]
    );

    return result.rows[0] || null;
}

async function createSpace({ code, level, spaceType }) {
    try {
        const result = await query(
            `INSERT INTO parking.parking_spaces (code, level, space_type, status)
             VALUES ($1, $2, $3, 'available')
             RETURNING ${SPACE_COLUMNS}`,
            [code, level, spaceType]
        );

        return result.rows[0];
    } catch (error) {
        if (error instanceof AppError && error.pgCode === '23505') {
            if (error.pgConstraint === 'parking_spaces_code_key') {
                throw new AppError(
                    409,
                    CODES.VALIDATION_ERROR,
                    'Ya existe una plaza con el código indicado.',
                    [{ field: 'code', message: 'El código de plaza ya está registrado.' }]
                );
            }

            throw new AppError(
                409,
                CODES.VALIDATION_ERROR,
                'La plaza entra en conflicto con un registro existente.'
            );
        }

        if (error instanceof AppError && error.pgCode === '23514') {
            throw new AppError(
                422,
                CODES.VALIDATION_ERROR,
                'Los datos no cumplen las reglas del modelo de plazas.',
                [{ field: 'spaceType', message: 'El tipo o estado de la plaza no es válido.' }]
            );
        }

        throw error;
    }
}

async function updateSpaceStatus(id, nextStatus) {
    const allowedSources = sourceStatusesFor(nextStatus);

    if (allowedSources.length === 0) {
        throw new AppError(
            400,
            CODES.VALIDATION_ERROR,
            'Los datos enviados no son válidos.',
            [{ field: 'status', message: 'El estado indicado no es válido.' }]
        );
    }

    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = $2,
             reserved_by_reservation_id = CASE
                 WHEN $2 IN ('available', 'maintenance', 'reserved') THEN NULL
                 ELSE reserved_by_reservation_id
             END,
             updated_at = now()
         WHERE id = $1 AND status = ANY($3::text[])
         RETURNING ${SPACE_COLUMNS}`,
        [id, nextStatus, allowedSources]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await findSpaceById(id);
    if (!current) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'La plaza indicada no existe.');
    }

    throw transitionError(current.status, nextStatus);
}

function ownershipConflict(message) {
    return new AppError(
        409,
        CODES.RESERVATION_CONFLICT,
        message,
        [{ field: 'reservationId', message: 'La plaza está asignada a otra reserva.' }]
    );
}

function stateConflict(message) {
    return new AppError(
        409,
        CODES.INVALID_STATE_TRANSITION,
        message,
        [{ field: 'status', message: 'La transición de estado solicitada no es válida.' }]
    );
}

async function missingSpace(id) {
    const current = await findSpaceById(id);
    if (!current) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'La plaza indicada no existe.');
    }
    return current;
}

async function reserveSpace(id, reservationId) {
    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = 'reserved', reserved_by_reservation_id = $2, updated_at = now()
         WHERE id = $1 AND status = 'available'
         RETURNING ${SPACE_COLUMNS}`,
        [id, reservationId]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await missingSpace(id);

    if (current.status === 'reserved' && current.reserved_by_reservation_id === reservationId) {
        return current;
    }

    if (current.status === 'reserved') {
        throw ownershipConflict('La plaza ya está reservada por otra reserva.');
    }

    throw new AppError(
        409,
        CODES.SPACE_NOT_AVAILABLE,
        'La plaza no está disponible para reservarse.',
        [{
            field: 'status',
            message: `La plaza se encuentra en estado "${current.status}".`
        }]
    );
}

async function occupySpace(id, reservationId) {
    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = 'occupied', updated_at = now()
         WHERE id = $1 AND status = 'reserved' AND reserved_by_reservation_id = $2
         RETURNING ${SPACE_COLUMNS}`,
        [id, reservationId]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await missingSpace(id);

    if (current.status === 'occupied' && current.reserved_by_reservation_id === reservationId) {
        return current;
    }

    if (current.reserved_by_reservation_id && current.reserved_by_reservation_id !== reservationId) {
        throw ownershipConflict('La plaza no pertenece a la reserva indicada.');
    }

    throw stateConflict('La plaza no puede pasar a ocupada desde su estado actual.');
}

async function releaseSpace(id, reservationId) {
    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = 'available', reserved_by_reservation_id = NULL, updated_at = now()
         WHERE id = $1 AND status = 'reserved' AND reserved_by_reservation_id = $2
         RETURNING ${SPACE_COLUMNS}`,
        [id, reservationId]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await missingSpace(id);

    if (current.status === 'available') {
        return current;
    }

    if (current.status === 'reserved') {
        throw ownershipConflict('La plaza está reservada por otra reserva.');
    }

    throw stateConflict('La plaza no puede liberarse desde su estado actual.');
}

async function checkoutSpace(id, reservationId) {
    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = 'available', reserved_by_reservation_id = NULL, updated_at = now()
         WHERE id = $1 AND status = 'occupied' AND reserved_by_reservation_id = $2
         RETURNING ${SPACE_COLUMNS}`,
        [id, reservationId]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await missingSpace(id);

    if (current.status === 'available') {
        return current;
    }

    if (current.reserved_by_reservation_id && current.reserved_by_reservation_id !== reservationId) {
        throw ownershipConflict('La plaza ocupada pertenece a otra reserva.');
    }

    throw stateConflict('La plaza no puede liberarse al registrar la salida desde su estado actual.');
}

async function restoreSpace(id, reservationId) {
    const result = await query(
        `UPDATE parking.parking_spaces
         SET status = 'reserved', updated_at = now()
         WHERE id = $1 AND status = 'occupied' AND reserved_by_reservation_id = $2
         RETURNING ${SPACE_COLUMNS}`,
        [id, reservationId]
    );

    if (result.rows[0]) return result.rows[0];

    const current = await missingSpace(id);

    if (current.status === 'reserved' && current.reserved_by_reservation_id === reservationId) {
        return current;
    }

    if (current.reserved_by_reservation_id && current.reserved_by_reservation_id !== reservationId) {
        throw ownershipConflict('La plaza pertenece a otra reserva.');
    }

    throw stateConflict('La plaza no puede volver al estado reservado desde su estado actual.');
}

module.exports = {
    listSpaces,
    findSpaceById,
    createSpace,
    updateSpaceStatus,
    reserveSpace,
    occupySpace,
    releaseSpace,
    checkoutSpace,
    restoreSpace
};
