const { randomUUID } = require('crypto');
const pool = require('../db');
const { query, isUnavailable } = require('../lib/query');
const { AppError, CODES } = require('../lib/errors');

const DEFAULT_QUOTE_TTL_MINUTES = 30;
const SECONDS_PER_HOUR = 3600;

function quoteTtlMinutes() {
    const configured = Number(process.env.QUOTE_TTL_MINUTES);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUOTE_TTL_MINUTES;
}

// Politica de redondeo: se cobra cada hora iniciada; cualquier fraccion positiva
// se redondea hacia arriba, con minimo de una hora para duracion positiva.
function billableHoursFor(durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
    return Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_HOUR));
}

function resolveDurationSeconds(session) {
    const raw = session.durationSeconds;

    if (raw !== undefined && raw !== null && raw !== '') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
        throw new AppError(500, CODES.INTERNAL_ERROR, 'No se pudo determinar la duración de la sesión.');
    }

    if (session.entryAt && session.exitAt) {
        const millis = Date.parse(session.exitAt) - Date.parse(session.entryAt);
        if (Number.isFinite(millis) && millis >= 0) return Math.floor(millis / 1000);
    }

    throw new AppError(500, CODES.INTERNAL_ERROR, 'No se pudo determinar la duración de la sesión.');
}

async function getActiveTariff() {
    const result = await query(
        `SELECT hourly_rate_minor, currency
         FROM payments.tariffs
         WHERE is_active = TRUE
         ORDER BY effective_from DESC, created_at DESC
         LIMIT 1`
    );

    if (!result.rows.length) {
        throw new AppError(500, CODES.INTERNAL_ERROR, 'No existe una tarifa horaria configurada en payments.tariffs.');
    }

    return result.rows[0];
}

async function findQuoteById(quoteId) {
    const result = await query('SELECT * FROM payments.payment_quotes WHERE id = $1', [quoteId]);
    return result.rows[0] || null;
}

async function findPaymentById(paymentId) {
    const result = await query('SELECT * FROM payments.payments WHERE id = $1', [paymentId]);
    return result.rows[0] || null;
}

async function findPaymentBySession(sessionId) {
    const result = await query('SELECT * FROM payments.payments WHERE session_id = $1', [sessionId]);
    return result.rows[0] || null;
}

async function findPaymentByIdempotencyKey(idempotencyKey) {
    const result = await query('SELECT * FROM payments.payments WHERE idempotency_key = $1', [idempotencyKey]);
    return result.rows[0] || null;
}

async function findPaymentBySessionOrQuote(sessionId, quoteId) {
    const result = await query(
        'SELECT * FROM payments.payments WHERE session_id = $1 OR quote_id = $2 LIMIT 1',
        [sessionId, quoteId]
    );
    return result.rows[0] || null;
}

async function createQuote(sessionId, session) {
    const tariff = await getActiveTariff();
    const durationSeconds = resolveDurationSeconds(session);
    const billableHours = billableHoursFor(durationSeconds);
    const amountMinor = billableHours * tariff.hourly_rate_minor;
    const quoteId = randomUUID();
    const expiresAt = new Date(Date.now() + quoteTtlMinutes() * 60 * 1000);

    await query(
        `INSERT INTO payments.payment_quotes
            (id, session_id, duration_seconds, billable_hours, hourly_rate_minor, amount_minor, currency, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [quoteId, sessionId, durationSeconds, billableHours, tariff.hourly_rate_minor, amountMinor, tariff.currency, expiresAt]
    );

    return {
        quoteId,
        sessionId,
        durationSeconds,
        billableHours,
        hourlyRateMinor: tariff.hourly_rate_minor,
        amountMinor,
        currency: tariff.currency,
        expiresAt: expiresAt.toISOString()
    };
}

function replayResult(existing, sessionId, quoteId) {
    if (existing.session_id !== sessionId || existing.quote_id !== quoteId) {
        throw new AppError(
            409,
            CODES.PAYMENT_ALREADY_PROCESSED,
            'La Idempotency-Key ya fue utilizada en otra operación de pago.'
        );
    }
    return { payment: existing, replayed: true };
}

async function registerPayment({ sessionId, quoteId, idempotencyKey }) {
    const existingByKey = await findPaymentByIdempotencyKey(idempotencyKey);
    if (existingByKey) return replayResult(existingByKey, sessionId, quoteId);

    const quote = await findQuoteById(quoteId);
    if (!quote) {
        throw new AppError(404, CODES.RESOURCE_NOT_FOUND, 'La cotización indicada no existe.');
    }
    if (quote.session_id !== sessionId) {
        throw new AppError(422, CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos.', [
            { field: 'sessionId', message: 'La cotización no corresponde a la sesión indicada.' }
        ]);
    }
    if (new Date(quote.expires_at).getTime() <= Date.now()) {
        throw new AppError(422, CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos.', [
            { field: 'quoteId', message: 'La cotización ha expirado; solicite una nueva cotización.' }
        ]);
    }

    const alreadyProcessed = await findPaymentBySessionOrQuote(sessionId, quoteId);
    if (alreadyProcessed) {
        throw new AppError(409, CODES.PAYMENT_ALREADY_PROCESSED, 'La sesión indicada ya tiene un pago registrado.');
    }

    const paymentId = randomUUID();
    let inserted = null;

    try {
        const result = await pool.query(
            `INSERT INTO payments.payments
                (id, session_id, quote_id, idempotency_key, amount_minor, currency, method, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'simulated', 'succeeded')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [paymentId, sessionId, quoteId, idempotencyKey, quote.amount_minor, quote.currency]
        );
        inserted = result.rows[0] || null;
    } catch (error) {
        if (error.code === '23505' && error.constraint === 'payments_idempotency_key_unique') {
            inserted = null;
        } else if (error.code === '23505') {
            console.error(`Conflicto de pago duplicado (${error.constraint}).`);
            throw new AppError(409, CODES.PAYMENT_ALREADY_PROCESSED, 'La sesión indicada ya tiene un pago registrado.');
        } else {
            console.error(`DATABASE_ERROR: ${error.message}`);
            if (isUnavailable(error)) {
                throw new AppError(
                    503,
                    CODES.SERVICE_UNAVAILABLE,
                    'El servicio de base de datos no está disponible temporalmente.'
                );
            }
            throw new AppError(500, CODES.DATABASE_ERROR, 'Error interno de base de datos.');
        }
    }

    if (inserted) return { payment: inserted, replayed: false };

    const concurrent = await findPaymentByIdempotencyKey(idempotencyKey);
    if (!concurrent) {
        throw new AppError(500, CODES.INTERNAL_ERROR, 'No se pudo registrar el pago.');
    }
    return replayResult(concurrent, sessionId, quoteId);
}

module.exports = {
    billableHoursFor,
    createQuote,
    registerPayment,
    findPaymentById,
    findPaymentBySession
};
