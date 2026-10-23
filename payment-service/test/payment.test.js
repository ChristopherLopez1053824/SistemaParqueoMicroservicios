const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { billableHoursFor } = require('../src/services/payments.service');

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';

let server;
let baseUrl;

test.before(async () => {
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    const text = await response.text();
    let body = null;

    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }

    return { status: response.status, headers: response.headers, body };
}

function jsonOptions(method, body, headers = {}) {
    return {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    };
}

test('GET /health responde correctamente', async () => {
    const response = await request('/health');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
        service: 'payment-service',
        status: 'ok'
    });
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
});

test('protege las rutas internas cuando INTERNAL_API_TOKEN está configurado', async () => {
    const protectedServer = http.createServer(createApp({ internalApiToken: 'token-interno' }));
    await new Promise((resolve) => protectedServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${protectedServer.address().port}/quote`;
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    };

    try {
        const unauthorized = await fetch(url, options);
        const unauthorizedBody = await unauthorized.json();
        const authorized = await fetch(url, {
            ...options,
            headers: { ...options.headers, 'x-internal-token': 'token-interno' }
        });
        const authorizedBody = await authorized.json();

        assert.equal(unauthorized.status, 401);
        assert.equal(unauthorizedBody.error.code, 'UNAUTHORIZED');
        assert.equal(authorized.status, 400);
        assert.equal(authorizedBody.error.code, 'VALIDATION_ERROR');
    } finally {
        await new Promise((resolve) => protectedServer.close(resolve));
    }
});

test('POST /quote valida sessionId sin consultar la base de datos', async () => {
    const response = await request('/quote', jsonOptions('POST', {}, {
        'x-request-id': REQUEST_ID
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'sessionId');
    assert.equal(response.body.error.requestId, REQUEST_ID);
    assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
});

test('POST /quote rechaza un UUID inválido', async () => {
    const response = await request('/quote', jsonOptions('POST', {
        sessionId: 'no-es-uuid'
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'sessionId');
});

test('POST / exige Idempotency-Key y method simulated', async () => {
    const response = await request('/payments', jsonOptions('POST', {
        quoteId: QUOTE_ID,
        sessionId: SESSION_ID
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    const fields = response.body.error.details.map((detail) => detail.field).sort();
    assert.deepEqual(fields, ['Idempotency-Key', 'method']);
});

test('POST / rechaza una Idempotency-Key que no es UUID', async () => {
    const response = await request('/payments', jsonOptions('POST', {
        quoteId: QUOTE_ID,
        sessionId: SESSION_ID,
        method: 'simulated'
    }, {
        'Idempotency-Key': 'no-es-uuid'
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'Idempotency-Key');
});

test('GET /session/:sessionId valida el UUID', async () => {
    const response = await request('/session/no-es-uuid');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_ID');
});

test('GET /:id valida el UUID', async () => {
    const response = await request('/payments/no-es-uuid');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_ID');
});

test('las rutas desconocidas devuelven error uniforme', async () => {
    const response = await request('/no/existe/ruta', {
        headers: { 'x-request-id': REQUEST_ID }
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(response.body.error.requestId, REQUEST_ID);
});

test('un JSON mal formado devuelve VALIDATION_ERROR', async () => {
    const response = await request('/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"sessionId":'
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('calcula horas facturables redondeando hacia arriba', () => {
    assert.equal(billableHoursFor(0), 0);
    assert.equal(billableHoursFor(1), 1);
    assert.equal(billableHoursFor(3600), 1);
    assert.equal(billableHoursFor(3601), 2);
    assert.equal(billableHoursFor(7200), 2);
});
