const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestIdFor(req, res) {
    const incoming = req.get('x-request-id');
    const requestId = typeof incoming === 'string' && UUID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    res.set('x-request-id', requestId);
    return requestId;
}

function sendError(req, res, statusCode, code, message, details = null) {
    const requestId = requestIdFor(req, res);
    res.status(statusCode).json({
        error: {
            code,
            message,
            details,
            requestId
        }
    });
}

function serializeSpace(row) {
    return {
        id: row.id,
        code: row.code,
        level: row.level,
        spaceType: row.space_type,
        status: row.status,
        reservedByReservationId: row.reserved_by_reservation_id || null
    };
}

function asyncHandler(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

async function findSpace(id) {
    const result = await pool.query(
        `SELECT id, code, level, space_type, status, reserved_by_reservation_id
         FROM parking.parking_spaces
         WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

function validateSpaceId(req, res) {
    if (!UUID_PATTERN.test(req.params.id)) {
        sendError(req, res, 400, 'INVALID_ID', 'El identificador de la plaza no es un UUID válido.');
        return false;
    }
    return true;
}

function validateReservationId(req, res) {
    if (!UUID_PATTERN.test(req.body?.reservationId || '')) {
        sendError(req, res, 400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', [
            { field: 'reservationId', message: 'Debe ser un UUID válido.' }
        ]);
        return false;
    }
    return true;
}

router.get('/spaces', asyncHandler(async (req, res) => {
    const result = await pool.query(`
        SELECT id, code, level, space_type, status
        FROM parking.parking_spaces
        ORDER BY code
    `);

    res.json({
        total: result.rowCount,
        spaces: result.rows
    });
}));

router.get('/spaces/:id', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res)) {
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    requestIdFor(req, res);
    res.status(200).json({ data: serializeSpace(space) });
}));

router.post('/spaces/:id/reserve', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res) || !validateReservationId(req, res)) {
        return;
    }

    const reservationId = req.body.reservationId;
    const result = await pool.query(
        `UPDATE parking.parking_spaces
         SET status = 'reserved',
             reserved_by_reservation_id = $2,
             updated_at = NOW()
         WHERE id = $1 AND status = 'available'
         RETURNING id, code, level, space_type, status, reserved_by_reservation_id`,
        [req.params.id, reservationId]
    );

    if (result.rows[0]) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(result.rows[0]) });
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    if (space.status === 'reserved' && space.reserved_by_reservation_id === reservationId) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(space) });
        return;
    }

    sendError(req, res, 409, 'SPACE_NOT_AVAILABLE', 'La plaza no está disponible para reservar.', [
        { field: 'status', message: `Estado actual: ${space.status}.` }
    ]);
}));

router.post('/spaces/:id/occupy', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res) || !validateReservationId(req, res)) {
        return;
    }

    const reservationId = req.body.reservationId;
    const result = await pool.query(
        `UPDATE parking.parking_spaces
         SET status = 'occupied',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'reserved'
           AND reserved_by_reservation_id = $2
         RETURNING id, code, level, space_type, status, reserved_by_reservation_id`,
        [req.params.id, reservationId]
    );

    if (result.rows[0]) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(result.rows[0]) });
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    if (space.status === 'occupied' && space.reserved_by_reservation_id === reservationId) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(space) });
        return;
    }

    sendError(req, res, 409, 'INVALID_STATE_TRANSITION', 'La plaza no puede pasar a ocupada.', [
        { field: 'status', message: `Estado actual: ${space.status}.` }
    ]);
}));

router.post('/spaces/:id/release', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res) || !validateReservationId(req, res)) {
        return;
    }

    const reservationId = req.body.reservationId;
    const result = await pool.query(
        `UPDATE parking.parking_spaces
         SET status = 'available',
             reserved_by_reservation_id = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'reserved'
           AND reserved_by_reservation_id = $2
         RETURNING id, code, level, space_type, status, reserved_by_reservation_id`,
        [req.params.id, reservationId]
    );

    if (result.rows[0]) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(result.rows[0]) });
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    if (space.status === 'available') {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(space) });
        return;
    }

    sendError(req, res, 409, 'INVALID_STATE_TRANSITION', 'La plaza no está reservada por esta reserva.', [
        { field: 'status', message: `Estado actual: ${space.status}.` }
    ]);
}));

router.post('/spaces/:id/checkout', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res) || !validateReservationId(req, res)) {
        return;
    }

    const reservationId = req.body.reservationId;
    const result = await pool.query(
        `UPDATE parking.parking_spaces
         SET status = 'available',
             reserved_by_reservation_id = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'occupied'
           AND reserved_by_reservation_id = $2
         RETURNING id, code, level, space_type, status, reserved_by_reservation_id`,
        [req.params.id, reservationId]
    );

    if (result.rows[0]) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(result.rows[0]) });
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    if (space.status === 'available') {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(space) });
        return;
    }

    sendError(req, res, 409, 'INVALID_STATE_TRANSITION', 'La plaza no está ocupada por esta reserva.', [
        { field: 'status', message: `Estado actual: ${space.status}.` }
    ]);
}));

router.post('/spaces/:id/restore', asyncHandler(async (req, res) => {
    if (!validateSpaceId(req, res) || !validateReservationId(req, res)) {
        return;
    }

    const reservationId = req.body.reservationId;
    const result = await pool.query(
        `UPDATE parking.parking_spaces
         SET status = 'reserved',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'occupied'
           AND reserved_by_reservation_id = $2
         RETURNING id, code, level, space_type, status, reserved_by_reservation_id`,
        [req.params.id, reservationId]
    );

    if (result.rows[0]) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(result.rows[0]) });
        return;
    }

    const space = await findSpace(req.params.id);

    if (!space) {
        sendError(req, res, 404, 'SPACE_NOT_FOUND', 'La plaza solicitada no existe.');
        return;
    }

    if (space.status === 'reserved' && space.reserved_by_reservation_id === reservationId) {
        requestIdFor(req, res);
        res.status(200).json({ data: serializeSpace(space) });
        return;
    }

    sendError(req, res, 409, 'INVALID_STATE_TRANSITION', 'La plaza no puede volver al estado reservado.', [
        { field: 'status', message: `Estado actual: ${space.status}.` }
    ]);
}));

router.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const isInvalidJson = error && error.type === 'entity.parse.failed';
    sendError(
        req,
        res,
        isInvalidJson ? 400 : 500,
        isInvalidJson ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        isInvalidJson ? 'El cuerpo JSON de la solicitud no es válido.' : 'Ocurrió un error interno inesperado.'
    );
});

module.exports = router;
