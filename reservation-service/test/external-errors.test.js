const test = require('node:test');
const assert = require('node:assert/strict');
const { ParkingServiceError } = require('../src/http/parking-client');
const {
    createTestContext,
    startServer,
    stopServer,
    request
} = require('./helpers/test-app');

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

async function setup(t) {
    const context = createTestContext();
    const server = await startServer(context.app);
    t.after(() => stopServer(server));
    return { ...context, server };
}

function createBody() {
    return {
        spaceId: SPACE_ID,
        vehiclePlate: 'P123ABC'
    };
}

test('traduce indisponibilidad de Parking Service a 503', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    parkingClient.failGetSpace = new ParkingServiceError('unavailable', 'sin conexión');

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
});

test('traduce timeouts de Parking Service a 504', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    parkingClient.failReserveSpace = new ParkingServiceError('timeout', 'sin respuesta');

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 504);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
});

test('traduce respuestas inválidas de Parking Service a 502', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    parkingClient.failGetSpace = new ParkingServiceError('bad_response', 'json inválido');

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
});

test('traduce un conflicto de Parking Service a 409', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    parkingClient.failReserveSpace = new ParkingServiceError('conflict', 'plaza tomada');

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'SPACE_NOT_AVAILABLE');
});

test('mantiene la estructura uniforme y propaga requestId', async (t) => {
    const { server } = await setup(t);

    const response = await request(server, 'POST', '/reservations', {
        body: { spaceId: SPACE_ID },
        headers: { 'x-request-id': REQUEST_ID }
    });

    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body.error).sort(), [
        'code',
        'details',
        'message',
        'requestId'
    ]);
    assert.equal(response.body.error.requestId, REQUEST_ID);
    assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
});

test('genera requestId cuando el encabezado no es un UUID', async (t) => {
    const { server } = await setup(t);

    const response = await request(server, 'GET', '/reservations/no-es-uuid', {
        headers: { 'x-request-id': 'valor-invalido' }
    });

    assert.equal(response.status, 400);
    assert.notEqual(response.body.error.requestId, 'valor-invalido');
    assert.match(response.body.error.requestId, /^[0-9a-f-]{36}$/i);
});

test('compensa la plaza si falla la inserción local de la reserva', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    repository.failInsertReservation = true;

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 500);
    assert.equal(repository.reservations.size, 0);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
    assert.equal(parkingClient.spaces.get(SPACE_ID).reservedByReservationId, null);
});

test('devuelve 503 si no puede compensar la plaza', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    repository.failInsertReservation = true;
    parkingClient.failReleaseSpace = new ParkingServiceError('timeout', 'sin respuesta');

    const response = await request(server, 'POST', '/reservations', { body: createBody() });

    assert.equal(response.status, 503);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'reserved');
});

test('restaura la plaza si falla la creación local de la sesión', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    repository.failInsertSession = true;

    const reservation = await request(server, 'POST', '/reservations', { body: createBody() });
    const entry = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);

    assert.equal(entry.status, 500);
    assert.equal(repository.sessions.size, 0);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'reserved');
    assert.equal(repository.reservations.get(reservation.body.data.id).status, 'confirmed');

    repository.failInsertSession = false;
    const retry = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);
    assert.equal(retry.status, 201);
});

test('permite reintentar la salida después de un fallo local', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, repository, clock } = context;
    parkingClient.addSpace(SPACE_ID);

    const reservation = await request(server, 'POST', '/reservations', { body: createBody() });
    const entry = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);
    const sessionId = entry.body.data.sessionId;

    repository.failCompleteSession = true;
    clock.value = new Date(new Date(clock.value).getTime() + 30000);

    const failedExit = await request(server, 'POST', `/sessions/${sessionId}/exit`);
    assert.equal(failedExit.status, 500);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
    assert.equal(repository.sessions.get(sessionId).status, 'active');
    assert.equal(repository.reservations.get(reservation.body.data.id).status, 'confirmed');

    repository.failCompleteSession = false;
    const retry = await request(server, 'POST', `/sessions/${sessionId}/exit`);

    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.status, 'completed');
    assert.equal(repository.reservations.get(reservation.body.data.id).status, 'completed');
});

test('no cierra la sesión si Parking Service falla al liberar la plaza', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, repository } = context;
    parkingClient.addSpace(SPACE_ID);

    const reservation = await request(server, 'POST', '/reservations', { body: createBody() });
    const entry = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);
    parkingClient.failCheckoutSpace = new ParkingServiceError('conflict', 'estado incompatible');

    const exit = await request(server, 'POST', `/sessions/${entry.body.data.sessionId}/exit`);

    assert.equal(exit.status, 409);
    assert.equal(exit.body.error.code, 'INVALID_STATE_TRANSITION');
    assert.equal(repository.sessions.get(entry.body.data.sessionId).status, 'active');
});
