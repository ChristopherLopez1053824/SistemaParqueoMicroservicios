const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createTestContext,
    startServer,
    stopServer,
    request
} = require('./helpers/test-app');

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SPACE_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_SPACE_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_RESERVATION_ID = '44444444-4444-4444-8444-444444444444';

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

test('crea una reserva válida y reserva la plaza', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const response = await createReservation(server);

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'confirmed');
    assert.equal(response.body.data.spaceId, SPACE_ID);
    assert.equal(response.body.data.vehiclePlate, 'P123ABC');
    assert.match(response.body.data.createdAt, /Z$/);
    assert.match(response.body.data.updatedAt, /Z$/);

    const space = parkingClient.spaces.get(SPACE_ID);
    assert.equal(space.status, 'reserved');
    assert.equal(space.reservedByReservationId, response.body.data.id);
    assert.equal(repository.reservations.size, 1);
});

test('rechaza un cuerpo incompleto con el formato uniforme de errores', async (t) => {
    const { server } = await setup(t);

    const response = await request(server, 'POST', '/reservations', {
        body: { spaceId: SPACE_ID }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'vehiclePlate');
    assert.match(response.body.error.requestId, /^[0-9a-f-]{36}$/i);
});

test('rechaza un UUID inválido en el cuerpo y en la ruta', async (t) => {
    const { server } = await setup(t);

    const invalidBody = await request(server, 'POST', '/reservations', {
        body: { spaceId: 'no-es-uuid', vehiclePlate: 'P123ABC' }
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.body.error.code, 'VALIDATION_ERROR');
    assert.equal(invalidBody.body.error.details[0].field, 'spaceId');

    const invalidPath = await request(server, 'GET', '/reservations/no-es-uuid');
    assert.equal(invalidPath.status, 400);
    assert.equal(invalidPath.body.error.code, 'INVALID_ID');
});

test('rechaza JSON mal formado', async (t) => {
    const { server } = await setup(t);

    const response = await request(server, 'POST', '/reservations', {
        rawBody: '{"spaceId":'
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details, null);
});

test('rechaza una plaza inexistente', async (t) => {
    const { server } = await setup(t);

    const response = await createReservation(server, { spaceId: MISSING_SPACE_ID });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'RESOURCE_NOT_FOUND');
});

test('rechaza plazas ocupadas, reservadas o en mantenimiento', async (t) => {
    for (const status of ['occupied', 'reserved', 'maintenance']) {
        const { server, parkingClient } = await setup(t);
        parkingClient.addSpace(SPACE_ID, {
            status,
            reservedByReservationId: status === 'reserved' ? OTHER_SPACE_ID : null
        });

        const response = await createReservation(server);

        assert.equal(response.status, 409, `estado ${status}`);
        assert.equal(response.body.error.code, 'SPACE_NOT_AVAILABLE');
    }
});

test('lista reservas con data y meta.total', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);
    parkingClient.addSpace(OTHER_SPACE_ID);

    const first = await createReservation(server);
    const second = await createReservation(server, { spaceId: OTHER_SPACE_ID, vehiclePlate: 'M456XYZ' });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const response = await request(server, 'GET', '/reservations');

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body.data), true);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 2);
    assert.equal(response.body.reservations, undefined);
});

test('consulta una reserva existente e inexistente', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await createReservation(server);
    const found = await request(server, 'GET', `/reservations/${created.body.data.id}`);

    assert.equal(found.status, 200);
    assert.equal(found.body.data.id, created.body.data.id);

    const missing = await request(server, 'GET', `/reservations/${MISSING_RESERVATION_ID}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'RESOURCE_NOT_FOUND');
});

test('cancela una reserva válida y libera la plaza', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await createReservation(server);
    const cancelled = await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
    assert.equal(parkingClient.spaces.get(SPACE_ID).reservedByReservationId, null);
});

test('rechaza cancelaciones incompatibles con el estado', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await createReservation(server);
    await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);

    const secondCancel = await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);
    assert.equal(secondCancel.status, 409);
    assert.equal(secondCancel.body.error.code, 'INVALID_STATE_TRANSITION');

    repository.reservations.get(created.body.data.id).status = 'completed';
    const completedCancel = await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);
    assert.equal(completedCancel.status, 409);
    assert.equal(completedCancel.body.error.code, 'INVALID_STATE_TRANSITION');

    const missing = await request(server, 'PATCH', `/reservations/${MISSING_RESERVATION_ID}/cancel`);
    assert.equal(missing.status, 404);
});

test('no cancela una reserva con sesión activa', async (t) => {
    const { server, parkingClient } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await createReservation(server);
    const entry = await request(server, 'POST', `/sessions/${created.body.data.id}/entry`);
    assert.equal(entry.status, 201);

    const cancelled = await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);

    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.error.code, 'RESERVATION_CONFLICT');
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'occupied');
});

test('compensa la plaza si ya existe una reserva confirmada localmente', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const now = new Date('2026-01-01T09:00:00.000Z');
    repository.reservations.set(MISSING_RESERVATION_ID, {
        id: MISSING_RESERVATION_ID,
        space_id: SPACE_ID,
        vehicle_plate: 'OLDPLATE',
        status: 'confirmed',
        starts_at: now,
        ends_at: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        space_claimed_at: now,
        created_at: now,
        updated_at: now
    });

    const response = await createReservation(server);

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'RESERVATION_CONFLICT');
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
    assert.equal(repository.reservations.size, 1);
});

test('solicitudes concurrentes solo crean una reserva para la misma plaza', async (t) => {
    const { server, parkingClient, repository } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const [first, second] = await Promise.all([
        createReservation(server),
        createReservation(server, { vehiclePlate: 'OTHERPLATE' })
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(repository.reservations.size, 1);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'reserved');
});
