import { request } from './api';

export async function createQuote(sessionId) {
    return (await request('/api/payments/quote', {
        method: 'POST',
        body: { sessionId }
    })).data;
}

// idempotencyKey se genera una vez por intento de pago y se reutiliza en los reintentos.
export async function createPayment({ quoteId, sessionId }, idempotencyKey) {
    return (await request('/api/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { quoteId, sessionId, method: 'simulated' }
    })).data;
}

export async function getPayment(id) {
    return (await request(`/api/payments/${id}`)).data;
}

export async function getPaymentBySession(sessionId) {
    return (await request(`/api/payments/session/${sessionId}`)).data;
}
