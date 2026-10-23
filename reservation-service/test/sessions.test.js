const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createTestContext,
    startServer,
    stopServer,
    request
} = require('./helpers/test-app');

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_SESSION_ID = '55555555-5555-4555-8555-555555555555';

async function setup(t) {
    const context = createTestContext();
    const server = await startServer(context.app);
    t.after(() => stopServer(server));
    return { ...context, server };
}

async function createReservation(server, overrides = {}) {
    return request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            ...overrides
        }
    });
}

async function createActiveSession(server, context) {
    const reservation = await createReservation(server);
    const entry = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);
    return { reservation: reservation.body.data, session: entry.body.data };
}

test('registra una entrada válida y ocupa la plaza', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, repository } = context;
    parkingClient.addSpace(SPACE_ID);

    const reservation = await createReservation(server);
    const response = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);

    assert.equal(response.status, 201);
    assert.match(response.body.data.sessionId, /^[0-9a-f-]{36}$/i);
    assert.equal(response.body.data.reservationId, reservation.body.data.id);
    assert.equal(response.body.data.spaceId, SPACE_ID);
    assert.equal(response.body.data.vehiclePlate, 'P123ABC');
    assert.equal(response.body.data.status, 'active');
    assert.match(response.body.data.entryAt, /Z$/);
    assert.equal(response.body.data.exitAt, null);
    assert.equal(response.body.data.durationSeconds, null);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'occupied');
    assert.equal(repository.sessions.size, 1);
    assert.equal(repository.reservations.get(reservation.body.data.id).status, 'confirmed');
});

test('evita entradas duplicadas para una misma reserva', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const reservation = await createReservation(server);
    const first = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);
    const second = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'RESERVATION_CONFLICT');
    assert.equal(repository.sessions.size, 1);
});

test('rechaza entradas de reservas canceladas o completadas', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const cancelledReservation = await createReservation(server);
    await request(server, 'PATCH', `/reservations/${cancelledReservation.body.data.id}/cancel`);
    const cancelledEntry = await request(server, 'POST', `/sessions/${cancelledReservation.body.data.id}/entry`);
    assert.equal(cancelledEntry.status, 409);
    assert.equal(cancelledEntry.body.error.code, 'INVALID_STATE_TRANSITION');

    parkingClient.addSpace('66666666-6666-4666-8666-666666666666');
    const completedReservation = await createReservation(server, {
        spaceId: '66666666-6666-4666-8666-666666666666',
        vehiclePlate: 'Q999ZZZ'
    });
    repository.reservations.get(completedReservation.body.data.id).status = 'completed';

    const completedEntry = await request(server, 'POST', `/sessions/${completedReservation.body.data.id}/entry`);
    assert.equal(completedEntry.status, 409);
    assert.equal(completedEntry.body.error.code, 'INVALID_STATE_TRANSITION');
});

test('rechaza la entrada si la plaza no está reservada por la reserva', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const reservation = await createReservation(server);
    parkingClient.spaces.get(SPACE_ID).status = 'available';
    parkingClient.spaces.get(SPACE_ID).reservedByReservationId = null;

    const response = await request(server, 'POST', `/sessions/${reservation.body.data.id}/entry`);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE_TRANSITION');
});

test('registra una salida válida, calcula durationSeconds y libera la plaza', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, repository, clock } = context;
    parkingClient.addSpace(SPACE_ID);

    const { reservation, session } = await createActiveSession(server, context);
    clock.value = new Date(new Date(clock.value).getTime() + 90500);

    const response = await request(server, 'POST', `/sessions/${session.sessionId}/exit`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.sessionId, session.sessionId);
    assert.equal(response.body.data.status, 'completed');
    assert.match(response.body.data.exitAt, /Z$/);
    assert.equal(response.body.data.durationSeconds, 90);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
    assert.equal(parkingClient.spaces.get(SPACE_ID).reservedByReservationId, null);
    assert.equal(repository.reservations.get(reservation.id).status, 'completed');
});

test('evita el cierre doble de una sesión', async (t) => {
    const context = await setup(t);
    const { server, parkingClient } = context;
    parkingClient.addSpace(SPACE_ID);

    const { session } = await createActiveSession(server, context);
    context.clock.value = new Date(new Date(context.clock.value).getTime() + 1000);

    const first = await request(server, 'POST', `/sessions/${session.sessionId}/exit`);
    const second = await request(server, 'POST', `/sessions/${session.sessionId}/exit`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'SESSION_ALREADY_COMPLETED');
});

test('solicitudes simultáneas de salida solo cierran una vez', async (t) => {
    const context = await setup(t);
    const { server, parkingClient } = context;
    parkingClient.addSpace(SPACE_ID);

    const { session } = await createActiveSession(server, context);
    context.clock.value = new Date(new Date(context.clock.value).getTime() + 5000);

    const [first, second] = await Promise.all([
        request(server, 'POST', `/sessions/${session.sessionId}/exit`),
        request(server, 'POST', `/sessions/${session.sessionId}/exit`)
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
});

test('rechaza finalizar una sesión cancelada', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, repository } = context;
    parkingClient.addSpace(SPACE_ID);

    const { session } = await createActiveSession(server, context);
    repository.sessions.get(session.sessionId).status = 'cancelled';

    const response = await request(server, 'POST', `/sessions/${session.sessionId}/exit`);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INVALID_STATE_TRANSITION');
});

test('no produce duraciones negativas', async (t) => {
    const context = await setup(t);
    const { server, parkingClient } = context;
    parkingClient.addSpace(SPACE_ID);

    const { session } = await createActiveSession(server, context);
    context.clock.value = new Date(new Date(context.clock.value).getTime() - 60000);

    const response = await request(server, 'POST', `/sessions/${session.sessionId}/exit`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.durationSeconds, 0);
});

test('consulta sesiones existentes e inexistentes', async (t) => {
    const context = await setup(t);
    const { server, parkingClient } = context;
    parkingClient.addSpace(SPACE_ID);

    const { session } = await createActiveSession(server, context);

    const found = await request(server, 'GET', `/sessions/${session.sessionId}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.data.sessionId, session.sessionId);
    assert.equal(found.body.data.status, 'active');

    const missing = await request(server, 'GET', `/sessions/${MISSING_SESSION_ID}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'RESOURCE_NOT_FOUND');
});
