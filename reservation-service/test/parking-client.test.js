const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ParkingClient, ParkingServiceError } = require('../src/http/parking-client');

async function startParkingServer(handler) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
}

async function stopParkingServer(server) {
    await new Promise((resolve) => server.close(resolve));
}

function baseUrl(server) {
    return `http://127.0.0.1:${server.address().port}`;
}

test('envía el token interno a Parking Service', async (t) => {
    let receivedToken = null;
    const server = await startParkingServer((req, res) => {
        receivedToken = req.headers['x-internal-token'];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { status: 'available' } }));
    });
    t.after(() => stopParkingServer(server));

    const client = new ParkingClient({
        baseUrl: baseUrl(server),
        timeoutMs: 1000,
        internalApiToken: 'token-de-prueba'
    });
    await client.getSpace('11111111-1111-4111-8111-111111111111');

    assert.equal(receivedToken, 'token-de-prueba');
});

test('interpreta una respuesta válida de Parking Service', async (t) => {
    const server = await startParkingServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            data: {
                id: '11111111-1111-4111-8111-111111111111',
                status: 'available',
                reservedByReservationId: null
            }
        }));
    });
    t.after(() => stopParkingServer(server));

    const client = new ParkingClient({ baseUrl: baseUrl(server), timeoutMs: 1000 });
    const space = await client.getSpace('11111111-1111-4111-8111-111111111111');

    assert.equal(space.status, 'available');
});

test('clasifica JSON inválido como bad_response', async (t) => {
    const server = await startParkingServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":');
    });
    t.after(() => stopParkingServer(server));

    const client = new ParkingClient({ baseUrl: baseUrl(server), timeoutMs: 1000 });

    await assert.rejects(
        () => client.getSpace('11111111-1111-4111-8111-111111111111'),
        (error) => error instanceof ParkingServiceError && error.kind === 'bad_response'
    );
});

test('clasifica un timeout como timeout', async (t) => {
    const server = await startParkingServer((req, res) => {
        setTimeout(() => {
            if (!res.writableEnded) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: { status: 'available' } }));
            }
        }, 200);
    });
    t.after(() => stopParkingServer(server));

    const client = new ParkingClient({ baseUrl: baseUrl(server), timeoutMs: 30 });

    await assert.rejects(
        () => client.getSpace('11111111-1111-4111-8111-111111111111'),
        (error) => error instanceof ParkingServiceError && error.kind === 'timeout'
    );
});

test('clasifica errores HTTP de Parking Service', async (t) => {
    const server = await startParkingServer((req, res) => {
        if (req.url.includes('missing')) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'SPACE_NOT_FOUND', message: 'no existe' } }));
            return;
        }

        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'no disponible' } }));
    });
    t.after(() => stopParkingServer(server));

    const client = new ParkingClient({ baseUrl: baseUrl(server), timeoutMs: 1000 });

    await assert.rejects(
        () => client.getSpace('missing'),
        (error) => error instanceof ParkingServiceError && error.kind === 'not_found'
    );

    await assert.rejects(
        () => client.getSpace('11111111-1111-4111-8111-111111111111'),
        (error) => error instanceof ParkingServiceError && error.kind === 'server'
    );
});
