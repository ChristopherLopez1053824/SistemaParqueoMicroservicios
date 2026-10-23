const { AppError, CODES } = require('../lib/errors');
const { isUuid, isPlainObject, requiredTrimmedString } = require('../lib/validate');
const { SPACE_TYPES, DEFAULT_SPACE_TYPE, ADMIN_ASSIGNABLE_TRANSITIONS } = require('../lib/constants');

const ADMIN_ASSIGNABLE_STATUSES = Object.keys(ADMIN_ASSIGNABLE_TRANSITIONS);
const spaces = require('../services/parking.service');

function toIso(value) {
    return value ? new Date(value).toISOString() : null;
}

function toSpaceJson(row, { includeReservation = false } = {}) {
    const space = {
        id: row.id,
        code: row.code,
        level: row.level,
        spaceType: row.space_type,
        status: row.status,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };

    if (includeReservation) {
        space.reservedByReservationId = row.reserved_by_reservation_id || null;
    }

    return space;
}

function reservationIdFrom(body) {
    const reservationId = isPlainObject(body) ? body.reservationId : undefined;

    if (!isUuid(reservationId)) {
        throw new AppError(
            400,
            CODES.VALIDATION_ERROR,
            'Los datos enviados no son válidos.',
            [{
                field: 'reservationId',
                message: 'El identificador de la reserva es obligatorio y debe ser un UUID v4 válido.'
            }]
        );
    }

    return reservationId;
}

async function runTransition(req, res, transition) {
    const { id } = req.params;

    if (!isUuid(id)) {
        throw new AppError(400, CODES.INVALID_ID, 'El identificador de la plaza no es un UUID v4 válido.');
    }

    const reservationId = reservationIdFrom(req.body);
    const space = await transition(id, reservationId);

    res.status(200).json({ data: toSpaceJson(space, { includeReservation: true }) });
}

async function listSpaces(req, res) {
    const rows = await spaces.listSpaces();

    res.status(200).json({
        data: rows.map(toSpaceJson),
        meta: { total: rows.length }
    });
}

async function getSpace(req, res) {
    const { id } = req.params;

    if (!isUuid(id)) {
        throw new AppError(400, CODES.INVALID_ID, 'El identificador de la plaza no es un UUID v4 válido.');
    }

    const space = await spaces.findSpaceById(id);
    if (!space) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'La plaza indicada no existe.');
    }

    res.status(200).json({ data: toSpaceJson(space, { includeReservation: true }) });
}

async function createSpace(req, res) {
    const body = isPlainObject(req.body) ? req.body : {};
    const errors = [];
    const code = requiredTrimmedString(body, 'code', errors);
    const level = requiredTrimmedString(body, 'level', errors);
    const spaceType = body.spaceType === undefined ? DEFAULT_SPACE_TYPE : body.spaceType;

    if (!SPACE_TYPES.includes(spaceType)) {
        errors.push({
            field: 'spaceType',
            message: 'El tipo debe ser "standard", "accessible" o "electric".'
        });
    }

    if (errors.length > 0) {
        throw new AppError(400, CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos.', errors);
    }

    const space = await spaces.createSpace({ code, level, spaceType });
    res.status(201).json({ data: toSpaceJson(space) });
}

async function updateSpaceStatus(req, res) {
    const { id } = req.params;

    if (!isUuid(id)) {
        throw new AppError(400, CODES.INVALID_ID, 'El identificador de la plaza no es un UUID v4 válido.');
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const status = body.status;

    if (typeof status !== 'string' || !ADMIN_ASSIGNABLE_STATUSES.includes(status)) {
        throw new AppError(
            400,
            CODES.VALIDATION_ERROR,
            'Los datos enviados no son válidos.',
            [{
                field: 'status',
                message: 'Este endpoint solo administra los estados "available" y "maintenance". '
                    + 'Para reservar, ocupar, liberar u ocupar una plaza use los endpoints de reserva asociados a una reservación.'
            }]
        );
    }

    const space = await spaces.updateSpaceStatus(id, status);
    res.status(200).json({ data: toSpaceJson(space, { includeReservation: true }) });
}

async function reserveSpace(req, res) {
    await runTransition(req, res, spaces.reserveSpace);
}

async function occupySpace(req, res) {
    await runTransition(req, res, spaces.occupySpace);
}

async function releaseSpace(req, res) {
    await runTransition(req, res, spaces.releaseSpace);
}

async function checkoutSpace(req, res) {
    await runTransition(req, res, spaces.checkoutSpace);
}

async function restoreSpace(req, res) {
    await runTransition(req, res, spaces.restoreSpace);
}

module.exports = {
    listSpaces,
    getSpace,
    createSpace,
    updateSpaceStatus,
    reserveSpace,
    occupySpace,
    releaseSpace,
    checkoutSpace,
    restoreSpace
};
