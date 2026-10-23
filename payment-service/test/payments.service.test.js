const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db');
const { createQuote, registerPayment, findPaymentById, findPaymentBySession } = require('../src/services/payments.service');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '99999999-9999-4999-8999-999999999999';

// Repositorio en memoria que imita el esquema real de payments.* (incluye el
// índice único parcial "solo succeeded" de sql/02_payments_retry_after_failure.sql),
// para probar las reglas de negocio sin una base de datos real.
function createFakePaymentsStore() {
    const quotes = new Map();
    const payments = [];

    async function query(text, params = []) {
        if (text.includes('FROM payments.tariffs')) {
            return { rows: [{ hourly_rate_minor: 1500, currency: 'GTQ' }] };
        }

        if (text.includes('INSERT INTO payments.payment_quotes')) {
            const [id, session_id, duration_seconds, billable_hours, hourly_rate_minor, amount_minor, currency, expires_at] = params;
            quotes.set(id, { id, session_id, duration_seconds, billable_hours, hourly_rate_minor, amount_minor, currency, expires_at });
            return { rows: [] };
        }

        if (text.includes('FROM payments.payment_quotes WHERE id')) {
            const row = quotes.get(params[0]);
            return { rows: row ? [row] : [] };
        }

        if (text.includes('idempotency_key = $1')) {
            const row = payments.find((p) => p.idempotency_key === params[0]);
            return { rows: row ? [row] : [] };
        }

        if (text.includes("status = 'succeeded'") && text.includes('session_id = $1 OR quote_id')) {
            // Replica el índice único parcial: solo "succeeded" bloquea un reintento.
            const row = payments.find((p) => (p.session_id === params[0] || p.quote_id === params[1]) && p.status === 'succeeded');
            return { rows: row ? [row] : [] };
        }

        if (text.includes('FROM payments.payments WHERE session_id = $1')) {
            const row = payments.find((p) => p.session_id === params[0]);
            return { rows: row ? [row] : [] };
        }

        if (text.includes('FROM payments.payments WHERE id = $1')) {
            const row = payments.find((p) => p.id === params[0]);
            return { rows: row ? [row] : [] };
        }

        if (text.includes('INSERT INTO payments.payments')) {
            const [id, session_id, quote_id, idempotency_key, amount_minor, currency] = params;

            if (payments.some((p) => p.idempotency_key === idempotency_key)) {
                return { rows: [] }; // ON CONFLICT (idempotency_key) DO NOTHING
            }

            if (payments.some((p) => (p.session_id === session_id || p.quote_id === quote_id) && p.status === 'succeeded')) {
                const error = new Error('duplicate key value violates unique constraint');
                error.code = '23505';
                error.constraint = 'payments_session_id_succeeded_idx';
                throw error;
            }

            const row = {
                id,
                session_id,
                quote_id,
                idempotency_key,
                amount_minor,
                currency,
                method: 'simulated',
                status: 'succeeded',
                created_at: new Date()
            };
            payments.push(row);
            return { rows: [row] };
        }

        throw new Error(`Consulta inesperada: ${text}`);
    }

    return { query, quotes, payments };
}

function useFakeStore() {
    const store = createFakePaymentsStore();
    const original = pool.query;
    pool.query = store.query;
    return { store, restore: () => { pool.query = original; } };
}

async function createCompletedSessionQuote({ sessionId = SESSION_ID, durationSeconds = 3600 } = {}) {
    return createQuote(sessionId, { durationSeconds });
}

test('cotiza una sesión completada y calcula el importe de forma consistente', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote({ durationSeconds: 5400 });

    assert.equal(quote.durationSeconds, 5400);
    assert.equal(quote.billableHours, 2); // 1h30 redondea hacia arriba a 2 horas
    assert.equal(quote.hourlyRateMinor, 1500);
    assert.equal(quote.amountMinor, 3000); // entero: 2 * 1500, sin punto flotante
    assert.equal(quote.currency, 'GTQ');
});

test('confirma un pago simulado exitoso y lo deja consultable por sessionId', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote();
    const { payment, replayed } = await registerPayment({
        sessionId: SESSION_ID,
        quoteId: quote.quoteId,
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    });

    assert.equal(replayed, false);
    assert.equal(payment.status, 'succeeded');
    assert.equal(payment.amount_minor, quote.amountMinor);

    const bySession = await findPaymentBySession(SESSION_ID);
    assert.equal(bySession.id, payment.id);
});

test('no permite pagar dos veces la misma cotización', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote();
    await registerPayment({
        sessionId: SESSION_ID,
        quoteId: quote.quoteId,
        idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    });

    await assert.rejects(
        () => registerPayment({
            sessionId: SESSION_ID,
            quoteId: quote.quoteId,
            idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        }),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.code, 'PAYMENT_ALREADY_PROCESSED');
            return true;
        }
    );
});

test('repetir la misma Idempotency-Key reproduce el resultado original sin duplicar el pago', async (t) => {
    const { store, restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote();
    const key = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    const first = await registerPayment({ sessionId: SESSION_ID, quoteId: quote.quoteId, idempotencyKey: key });
    const second = await registerPayment({ sessionId: SESSION_ID, quoteId: quote.quoteId, idempotencyKey: key });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.payment.id, first.payment.id);
    assert.equal(store.payments.length, 1);
});

test('rechaza pagar con una cotización inexistente', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    await assert.rejects(
        () => registerPayment({
            sessionId: SESSION_ID,
            quoteId: '00000000-0000-4000-8000-000000000000',
            idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
        }),
        (error) => {
            assert.equal(error.status, 404);
            assert.equal(error.code, 'RESOURCE_NOT_FOUND');
            return true;
        }
    );
});

test('rechaza pagar una cotización vencida', async (t) => {
    const originalQuery = pool.query;
    t.after(() => { pool.query = originalQuery; });

    const quoteId = '22222222-2222-4222-8222-222222222222';

    pool.query = async (text) => {
        if (text.includes('FROM payments.payment_quotes WHERE id')) {
            return {
                rows: [{
                    id: quoteId,
                    session_id: SESSION_ID,
                    amount_minor: 1500,
                    currency: 'GTQ',
                    expires_at: new Date(Date.now() - 1000)
                }]
            };
        }
        if (text.includes('idempotency_key = $1')) {
            return { rows: [] };
        }
        throw new Error(`Consulta inesperada: ${text}`);
    };

    await assert.rejects(
        () => registerPayment({
            sessionId: SESSION_ID,
            quoteId,
            idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff'
        }),
        (error) => {
            assert.equal(error.status, 422);
            assert.equal(error.code, 'VALIDATION_ERROR');
            assert.equal(error.details[0].field, 'quoteId');
            return true;
        }
    );
});

test('rechaza una cotización que no corresponde a la sesión indicada', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote();

    await assert.rejects(
        () => registerPayment({
            sessionId: OTHER_SESSION_ID,
            quoteId: quote.quoteId,
            idempotencyKey: '11111111-2222-4333-8444-555555555555'
        }),
        (error) => {
            assert.equal(error.status, 422);
            assert.equal(error.details[0].field, 'sessionId');
            return true;
        }
    );
});

test('un intento previo fallido no bloquea un reintento legítimo con una nueva Idempotency-Key', async (t) => {
    const { store, restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote();

    // Simula un intento fallido anterior (hoy el simulador siempre tiene éxito;
    // esto representa el escenario que el índice único parcial debe tolerar).
    store.payments.push({
        id: 'failed-attempt-0000-0000-000000000000',
        session_id: SESSION_ID,
        quote_id: quote.quoteId,
        idempotency_key: 'previous-failed-key-000000000000',
        amount_minor: quote.amountMinor,
        currency: 'GTQ',
        method: 'simulated',
        status: 'failed',
        created_at: new Date()
    });

    const result = await registerPayment({
        sessionId: SESSION_ID,
        quoteId: quote.quoteId,
        idempotencyKey: 'a-brand-new-retry-key-00000000000'
    });

    assert.equal(result.replayed, false);
    assert.equal(result.payment.status, 'succeeded');

    const succeededCount = store.payments.filter((p) => p.status === 'succeeded').length;
    assert.equal(succeededCount, 1);

    // Pero un segundo intento EXITOSO sigue bloqueado: la obligación ya está cumplida.
    await assert.rejects(
        () => registerPayment({
            sessionId: SESSION_ID,
            quoteId: quote.quoteId,
            idempotencyKey: 'yet-another-retry-key-0000000000000'
        }),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.code, 'PAYMENT_ALREADY_PROCESSED');
            return true;
        }
    );
});

test('el importe a cobrar siempre proviene de la cotización almacenada, nunca de la solicitud', async (t) => {
    const { restore } = useFakeStore();
    t.after(restore);

    const quote = await createCompletedSessionQuote({ durationSeconds: 3600 });

    // registerPayment no acepta ni lee ningún campo de importe en absoluto.
    const { payment } = await registerPayment({
        sessionId: SESSION_ID,
        quoteId: quote.quoteId,
        idempotencyKey: 'no-amount-field-sent-0000000000000',
        amountMinor: 1 // si algo leyera esto, el importe cobrado sería incorrecto
    });

    assert.equal(payment.amount_minor, quote.amountMinor);
    assert.notEqual(payment.amount_minor, 1);

    const stored = await findPaymentById(payment.id);
    assert.equal(stored.amount_minor, quote.amountMinor);
});
