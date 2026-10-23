const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createTestContext,
    startServer,
    stopServer,
    request
} = require('./helpers/test-app');
const { ReservationService } = require('../src/services/reservation-service');
const { ExpirationService } = require('../src/services/expiration-service');
const { FakeReservationRepository, FakeParkingClient } = require('./helpers/fakes');
const { silentLogger } = require('./helpers/test-app');

const SPACE_ID = '11111111-1111-4111-8111-111111111111';

async function setup(t, options = {}) {
    const context = createTestContext(options);
    const server = await startServer(context.app);
    t.after(() => stopServer(server));
    return { ...context, server };
}

function isoAfterMinutes(clock, minutes) {
    return new Date(clock.value.getTime() + minutes * 60 * 1000).toISOString();
}

test('una reserva futura no reclama la plaza físicamente todavía', async (t) => {
    const context = await setup(t);
    const { server, parkingClient, clock } = context;
    parkingClient.addSpace(SPACE_ID);

    const response = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: isoAfterMinutes(clock, 60),
            durationMinutes: 60
        }
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.spaceClaimedAt, null);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
});

test('rechaza una reserva con demasiada anticipación', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const response = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: isoAfterMinutes(clock, 121)
        }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'startsAt');
});

test('rechaza una reserva con startsAt en el pasado', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const response = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: new Date(clock.value.getTime() - 10 * 60 * 1000).toISOString()
        }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details[0].field, 'startsAt');
});

test('rechaza reservar (incluso a futuro) una plaza en mantenimiento', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID, { status: 'maintenance' });

    const response = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: isoAfterMinutes(clock, 30)
        }
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'SPACE_NOT_AVAILABLE');
});

test('permite dos reservas futuras no solapadas para la misma plaza', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const first = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P111AAA',
            startsAt: isoAfterMinutes(clock, 10),
            durationMinutes: 30
        }
    });
    const second = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P222BBB',
            startsAt: isoAfterMinutes(clock, 60),
            durationMinutes: 30
        }
    });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
});

test('rechaza una reserva cuyo horario se superpone con otra ya confirmada', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const first = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P111AAA',
            startsAt: isoAfterMinutes(clock, 10),
            durationMinutes: 60
        }
    });
    assert.equal(first.status, 201);

    const overlapping = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P222BBB',
            startsAt: isoAfterMinutes(clock, 40), // cae dentro de [10,70) del primero
            durationMinutes: 30
        }
    });

    assert.equal(overlapping.status, 409);
    assert.equal(overlapping.body.error.code, 'RESERVATION_CONFLICT');
});

test('registrar la entrada de una reserva futura reclama la plaza en ese momento', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: isoAfterMinutes(clock, 15),
            durationMinutes: 60
        }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.spaceClaimedAt, null);

    const entry = await request(server, 'POST', `/sessions/${created.body.data.id}/entry`);

    assert.equal(entry.status, 201);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'occupied');

    const reservation = await request(server, 'GET', `/reservations/${created.body.data.id}`);
    assert.notEqual(reservation.body.data.spaceClaimedAt, null);
});

test('cancelar una reserva futura no reclamada no llama a liberar la plaza', async (t) => {
    const { server, parkingClient, clock } = await setup(t);
    parkingClient.addSpace(SPACE_ID);

    const created = await request(server, 'POST', '/reservations', {
        body: {
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            startsAt: isoAfterMinutes(clock, 15),
            durationMinutes: 60
        }
    });

    let releaseCalled = false;
    const originalRelease = parkingClient.releaseSpace.bind(parkingClient);
    parkingClient.releaseSpace = async (...args) => {
        releaseCalled = true;
        return originalRelease(...args);
    };

    const cancelled = await request(server, 'PATCH', `/reservations/${created.body.data.id}/cancel`);

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');
    assert.equal(releaseCalled, false);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
});

test('una reserva confirmada cuyo plazo de llegada venció sin check-in expira sola (no-show)', async () => {
    const clock = { value: new Date('2026-01-01T10:00:00.000Z') };
    const repository = new FakeReservationRepository({ currentTime: () => new Date(clock.value) });
    const parkingClient = new FakeParkingClient({ currentTime: () => new Date(clock.value) });
    const reservationService = new ReservationService({
        repository,
        parkingClient,
        logger: silentLogger,
        now: () => new Date(clock.value)
    });
    const expirationWorker = new ExpirationService({
        repository,
        reservationService,
        logger: silentLogger,
        pollIntervalMs: 10,
        graceMinutes: 30
    });

    parkingClient.addSpace(SPACE_ID);

    const created = await reservationService.createReservation({
        spaceId: SPACE_ID,
        vehiclePlate: 'P123ABC',
        startsAt: new Date(clock.value.getTime() + 10 * 60 * 1000).toISOString(),
        durationMinutes: 30
    }, { requestId: 'test' });

    assert.equal(created.spaceClaimedAt, null);

    // Todavía no venció el plazo de gracia: nada que expirar.
    assert.equal(await expirationWorker.runOnce(), false);

    // Avanza el reloj más allá de starts_at (10 min) + grace (30 min).
    clock.value = new Date(clock.value.getTime() + 45 * 60 * 1000);

    assert.equal(await expirationWorker.runOnce(), true);

    const reservation = await repository.findReservationById(created.id);
    assert.equal(reservation.status, 'cancelled');
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
});

test('una reserva inmediata que nunca entró libera la plaza al expirar por no-show', async () => {
    const clock = { value: new Date('2026-01-01T10:00:00.000Z') };
    const repository = new FakeReservationRepository({ currentTime: () => new Date(clock.value) });
    const parkingClient = new FakeParkingClient({ currentTime: () => new Date(clock.value) });
    const reservationService = new ReservationService({
        repository,
        parkingClient,
        logger: silentLogger,
        now: () => new Date(clock.value)
    });
    const expirationWorker = new ExpirationService({
        repository,
        reservationService,
        logger: silentLogger,
        pollIntervalMs: 10,
        graceMinutes: 30
    });

    parkingClient.addSpace(SPACE_ID);

    const created = await reservationService.createReservation({
        spaceId: SPACE_ID,
        vehiclePlate: 'P123ABC'
    }, { requestId: 'test' });

    assert.notEqual(created.spaceClaimedAt, null);
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'reserved');

    clock.value = new Date(clock.value.getTime() + 31 * 60 * 1000);

    assert.equal(await expirationWorker.runOnce(), true);

    const reservation = await repository.findReservationById(created.id);
    assert.equal(reservation.status, 'cancelled');
    assert.equal(parkingClient.spaces.get(SPACE_ID).status, 'available');
});

