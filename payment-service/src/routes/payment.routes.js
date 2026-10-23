const express = require('express');
const { AppError, CODES } = require('../lib/errors');
const { isUuid, uuidField } = require('../lib/validate');
const { fetchSession } = require('../services/reservation.client');
const payments = require('../services/payments.service');

const router = express.Router();

function toIso(value) {
    return value ? new Date(value).toISOString() : null;
}

function toPaymentJson(row) {
    return {
        id: row.id,
        paymentId: row.id,
        sessionId: row.session_id,
        quoteId: row.quote_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        method: row.method,
        status: row.status,
        createdAt: toIso(row.created_at)
    };
}

router.post('/quote', async (req, res) => {
    const body = req.body || {};
    const errors = [];
    const sessionId = uuidField(body, 'sessionId', errors);

    if (errors.length) {
        throw new AppError(400, CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos.', errors);
    }

    const session = await fetchSession(sessionId, req.requestId);
    if (!session) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'La sesión indicada no existe.');
    }
    if (session.status !== 'completed') {
        throw new AppError(409, CODES.INVALID_STATE_TRANSITION, 'La sesión debe estar finalizada para calcular el importe.');
    }

    const quote = await payments.createQuote(sessionId, session);
    res.status(200).json({ data: quote });
});

router.post('/', async (req, res) => {
    const body = req.body || {};
    const idempotencyKey = req.get('idempotency-key');
    const errors = [];

    if (!idempotencyKey) {
        errors.push({ field: 'Idempotency-Key', message: 'La cabecera Idempotency-Key es obligatoria.' });
    } else if (!isUuid(idempotencyKey)) {
        errors.push({ field: 'Idempotency-Key', message: 'La cabecera Idempotency-Key debe ser un UUID v4 válido.' });
    }

    const quoteId = uuidField(body, 'quoteId', errors);
    const sessionId = uuidField(body, 'sessionId', errors);

    if (body.method !== 'simulated') {
        errors.push({ field: 'method', message: 'El único método de pago permitido es "simulated".' });
    }

    if (errors.length) {
        throw new AppError(400, CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos.', errors);
    }

    const result = await payments.registerPayment({ sessionId, quoteId, idempotencyKey });
    res.status(result.replayed ? 200 : 201).json({ data: toPaymentJson(result.payment) });
});

router.get('/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    if (!isUuid(sessionId)) {
        throw new AppError(400, CODES.INVALID_ID, 'El identificador de sesión no es un UUID v4 válido.');
    }

    const payment = await payments.findPaymentBySession(sessionId);
    if (!payment) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'No existe un pago registrado para la sesión indicada.');
    }

    res.status(200).json({ data: toPaymentJson(payment) });
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
        throw new AppError(400, CODES.INVALID_ID, 'El identificador de pago no es un UUID v4 válido.');
    }

    const payment = await payments.findPaymentById(id);
    if (!payment) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'El pago indicado no existe.');
    }

    res.status(200).json({ data: toPaymentJson(payment) });
});

module.exports = router;
