const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const INTERNAL_TOKEN = 'token-interno-de-prueba';
const SPACE_ID = '11111111-1111-4111-8111-111111111111';

const silentLogger = {
    info() {},
    warn() {},
    error() {},
    log() {}
};

function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function close(server) {
    return new Promise((resolve) => server.close(resolve));
}

async function startUpstream(handler) {
    const server = http.createServer(handler);
    await listen(server);
    return {
        server,
        url: `http://127.0.0.1:${server.address().port}`
    };
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : null;
}

async function startGateway({
    parking,
    reservation,
    payment,
    proxyTimeoutMs = 1000,
    healthTimeoutMs = 500
}) {
    const app = createApp({
        services: { parking, reservation, payment },
        internalApiToken: INTERNAL_TOKEN,
        corsOrigins: ['http://localhost:5173'],
        proxyTimeoutMs,
        healthTimeoutMs,
        logger: silentLogger
    });
    const server = http.createServer(app);
    await listen(server);
    return {
        server,
        url: `http://127.0.0.1:${server.address().port}`
    };
}

async function request(baseUrl, path, options = {}) {
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

async function withStack(t) {
    const calls = [];
    const upstream = await startUpstream(async (req, res) => {
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
        calls.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { ok: true }, meta: { total: 1 } }));
    });
    t.after(() => close(upstream.server));

    const gateway = await startGateway({
        parking: upstream.url,
        reservation: upstream.url,
        payment: upstream.url
    });
    t.after(() => close(gateway.server));

    return { gateway, calls };
}

test('GET /health responde sin depender de los microservicios', async (t) => {
    const gateway = await startGateway({
        parking: 'http://127.0.0.1:1',
        reservation: 'http://127.0.0.1:1',
        payment: 'http://127.0.0.1:1'
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/health');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
        service: 'api-gateway',
        status: 'ok'
    });
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
});

test('enruta GET /api/parking/spaces conservando query string y token interno', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(gateway.url, '/api/parking/spaces?status=available', {
        headers: { 'x-request-id': REQUEST_ID, 'x-internal-token': 'token-del-cliente' }
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, '/spaces?status=available');
    assert.equal(calls[0].headers['x-internal-token'], INTERNAL_TOKEN);
    assert.equal(calls[0].headers['x-request-id'], REQUEST_ID);
    assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
    assert.deepEqual(response.body, { data: { ok: true }, meta: { total: 1 } });
});

test('propaga método, ruta y cuerpo a Parking', async (t) => {
    const { gateway, calls } = await withStack(t);
    const payload = { code: 'A-01', level: 'Nivel 1', spaceType: 'standard' };

    const response = await request(gateway.url, '/api/parking/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': REQUEST_ID },
        body: JSON.stringify(payload)
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/spaces');
    assert.deepEqual(calls[0].body, payload);
});

test('enruta PATCH /api/reservations/:id/cancel a Reservation', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(
        gateway.url,
        `/api/reservations/${SPACE_ID}/cancel`,
        { method: 'PATCH', headers: { 'x-request-id': REQUEST_ID } }
    );

    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, `/reservations/${SPACE_ID}/cancel`);
});

test('enruta el listado y la creación de reservas a /reservations', async (t) => {
    const { gateway, calls } = await withStack(t);
    const payload = { spaceId: SPACE_ID, vehiclePlate: 'P123ABC' };

    const list = await request(gateway.url, '/api/reservations?status=active');
    const create = await request(gateway.url, '/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': REQUEST_ID },
        body: JSON.stringify(payload)
    });

    assert.equal(list.status, 200);
    assert.equal(create.status, 200);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, '/reservations?status=active');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, '/reservations');
    assert.deepEqual(calls[1].body, payload);
});

test('enruta sesiones de Reservation conservando el segmento sessions', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(
        gateway.url,
        `/api/reservations/sessions/${SPACE_ID}/entry`,
        { method: 'POST', headers: { 'x-request-id': REQUEST_ID } }
    );

    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, `/sessions/${SPACE_ID}/entry`);
});

test('enruta POST /api/payments y conserva Idempotency-Key', async (t) => {
    const { gateway, calls } = await withStack(t);
    const payload = {
        quoteId: '22222222-2222-4222-8222-222222222222',
        sessionId: SPACE_ID,
        method: 'simulated'
    };

    const response = await request(gateway.url, '/api/payments', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': '33333333-3333-4333-8333-333333333333',
            'x-request-id': REQUEST_ID
        },
        body: JSON.stringify(payload)
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/');
    assert.equal(calls[0].headers['idempotency-key'], '33333333-3333-4333-8333-333333333333');
    assert.deepEqual(calls[0].body, payload);
});

test('enruta POST /api/payments/quote a Payment', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(gateway.url, '/api/payments/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': REQUEST_ID },
        body: JSON.stringify({ sessionId: SPACE_ID })
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/quote');
});

test('conserva códigos y cuerpos de error del microservicio', async (t) => {
    const upstream = await startUpstream((req, res) => {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Los datos enviados no son válidos.',
                details: [{ field: 'code', message: 'obligatorio' }],
                requestId: REQUEST_ID
            }
        }));
    });
    t.after(() => close(upstream.server));

    const gateway = await startGateway({
        parking: upstream.url,
        reservation: upstream.url,
        payment: upstream.url
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/api/parking/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': REQUEST_ID },
        body: '{}'
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.requestId, REQUEST_ID);
    assert.equal(response.body.error.details[0].field, 'code');
});

test('devuelve 404 uniforme para rutas desconocidas', async (t) => {
    const gateway = await startGateway({
        parking: 'http://127.0.0.1:1',
        reservation: 'http://127.0.0.1:1',
        payment: 'http://127.0.0.1:1'
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/api/desconocido', {
        headers: { 'x-request-id': REQUEST_ID }
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(response.body.error.details, null);
    assert.equal(response.body.error.requestId, REQUEST_ID);
});

test('devuelve 503 cuando el microservicio no está disponible', async (t) => {
    const closed = await startUpstream(() => {});
    const closedUrl = closed.url;
    await close(closed.server);

    const gateway = await startGateway({
        parking: closedUrl,
        reservation: closedUrl,
        payment: closedUrl
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/api/parking/spaces', {
        headers: { 'x-request-id': REQUEST_ID }
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(response.body.error.requestId, REQUEST_ID);
    assert.equal(response.body.error.details, null);
});

test('devuelve 504 cuando el microservicio excede el tiempo de espera', async (t) => {
    const upstream = await startUpstream((req, res) => {
        setTimeout(() => {
            if (!res.writableEnded) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: {} }));
            }
        }, 1000);
    });
    t.after(() => close(upstream.server));

    const gateway = await startGateway({
        parking: upstream.url,
        reservation: upstream.url,
        payment: upstream.url,
        proxyTimeoutMs: 100
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/api/parking/spaces', {
        headers: { 'x-request-id': REQUEST_ID }
    });

    assert.equal(response.status, 504);
    assert.equal(response.body.error.code, 'GATEWAY_TIMEOUT');
    assert.equal(response.body.error.requestId, REQUEST_ID);
});

test('genera requestId válido cuando el cliente no envía uno', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(gateway.url, '/api/parking/spaces');

    assert.equal(response.status, 200);
    assert.match(calls[0].headers['x-request-id'], /^[0-9a-f-]{36}$/i);
    assert.equal(
        response.headers.get('x-request-id'),
        calls[0].headers['x-request-id']
    );
});

test('ignora un requestId inválido y genera uno nuevo', async (t) => {
    const { gateway, calls } = await withStack(t);

    const response = await request(gateway.url, '/api/parking/spaces', {
        headers: { 'x-request-id': 'no-es-uuid' }
    });

    assert.equal(response.status, 200);
    assert.notEqual(calls[0].headers['x-request-id'], 'no-es-uuid');
    assert.match(calls[0].headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('/health/dependencies informa el estado de cada microservicio', async (t) => {
    const up = await startUpstream((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ service: 'fake', status: 'ok' }));
    });
    t.after(() => close(up.server));

    const closed = await startUpstream(() => {});
    const closedUrl = closed.url;
    await close(closed.server);

    const gateway = await startGateway({
        parking: up.url,
        reservation: up.url,
        payment: closedUrl
    });
    t.after(() => close(gateway.server));

    const degraded = await request(gateway.url, '/health/dependencies');

    assert.equal(degraded.status, 503);
    assert.equal(degraded.body.status, 'degraded');
    assert.deepEqual(degraded.body.dependencies, {
        parking: { status: 'up' },
        reservation: { status: 'up' },
        payment: { status: 'down' }
    });
});

test('configura CORS para el origen del frontend', async (t) => {
    const gateway = await startGateway({
        parking: 'http://127.0.0.1:1',
        reservation: 'http://127.0.0.1:1',
        payment: 'http://127.0.0.1:1'
    });
    t.after(() => close(gateway.server));

    const response = await request(gateway.url, '/api/parking/spaces', {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://localhost:5173',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'content-type,x-request-id'
        }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(response.headers.get('access-control-allow-methods'), /GET/);
    assert.match(response.headers.get('access-control-allow-headers'), /Idempotency-Key/i);
});
