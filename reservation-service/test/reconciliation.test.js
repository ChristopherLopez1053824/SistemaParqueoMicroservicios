const test = require('node:test');
const assert = require('node:assert/strict');
const { ParkingServiceError } = require('../src/http/parking-client');
const { ReconciliationService } = require('../src/services/reconciliation-service');
const { FakeReservationRepository, FakeParkingClient } = require('./helpers/fakes');
const { silentLogger } = require('./helpers/test-app');

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESERVATION_ID = '22222222-2222-4222-8222-222222222222';
const RESERVATION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';

function createContext() {
    const clock = {
        value: new Date('2026-01-01T10:00:00.000Z')
    };
    const repository = new FakeReservationRepository({
        currentTime: () => new Date(clock.value)
    });
    const parkingClient = new FakeParkingClient({
        currentTime: () => new Date(clock.value)
    });
    const worker = new ReconciliationService({
        repository,
        parkingClient,
        logger: silentLogger,
        workerId: 'test-worker',
        pollIntervalMs: 10,
        leaseSeconds: 60,
        retryBaseMs: 1000,
        retryMaxMs: 60000,
        maxAttempts: 3
    });

    return { clock, repository, parkingClient, worker };
}

function expireLease(clock) {
    clock.value = new Date(clock.value.getTime() + 120000);
}

test('recupera una reserva creada externamente antes de un reinicio', async () => {
    const { clock, repository, parkingClient, worker } = createContext();
    parkingClient.addSpace(SPACE_ID, {
        status: 'reserved',
        reservedByReservationId: RESERVATION_ID
    });

    await repository.createOperation({
        id: OPERATION_ID,
        operationType: 'reserve_space',
        reservationId: RESERVATION_ID,
        spaceId: SPACE_ID,
        payload: { vehiclePlate: 'P123ABC' },
        owner: 'api-que-fallo',
        maxAttempts: 3
    });

    expireLease(clock);
    assert.equal(await worker.runOnce(), true);

    const reservation = await repository.findReservationById(RESERVATION_ID);
    assert.equal(reservation.status, 'confirmed');
    assert.equal(reservation.space_id, SPACE_ID);
    assert.equal(repository.operations.get(OPERATION_ID).status, 'completed');
});

test('recupera una entrada ocupada externamente sin sesión local', async () => {
    const { clock, repository, parkingClient, worker } = createContext();
    const timestamp = new Date(clock.value);

    repository.reservations.set(RESERVATION_ID, {
        id: RESERVATION_ID,
        space_id: SPACE_ID,
        vehicle_plate: 'P123ABC',
        status: 'confirmed',
        created_at: timestamp,
        updated_at: timestamp
    });
    parkingClient.addSpace(SPACE_ID, {
        status: 'occupied',
        reservedByReservationId: RESERVATION_ID
    });

    await repository.createOperation({
        id: OPERATION_ID,
        operationType: 'occupy_space',
        reservationId: RESERVATION_ID,
        sessionId: SESSION_ID,
        spaceId: SPACE_ID,
        payload: {
            sessionId: SESSION_ID,
            reservationId: RESERVATION_ID,
            spaceId: SPACE_ID,
            vehiclePlate: 'P123ABC',
            entryAt: '2026-01-01T10:00:00.000Z'
        },
        owner: 'api-que-fallo',
        maxAttempts: 3
    });

    expireLease(clock);
    assert.equal(await worker.runOnce(), true);

    const session = await repository.findSessionById(SESSION_ID);
    assert.equal(session.status, 'active');
    assert.equal(session.reservation_id, RESERVATION_ID);
    assert.equal(repository.operations.get(OPERATION_ID).status, 'completed');
});

test('recupera una salida liberada externamente antes del commit local', async () => {
    const { clock, repository, parkingClient, worker } = createContext();
    const timestamp = new Date(clock.value);
    parkingClient.addSpace(SPACE_ID, { status: 'available' });

    repository.reservations.set(RESERVATION_ID, {
        id: RESERVATION_ID,
        space_id: SPACE_ID,
        vehicle_plate: 'P123ABC',
        status: 'confirmed',
        created_at: timestamp,
        updated_at: timestamp
    });
    repository.sessions.set(SESSION_ID, {
        id: SESSION_ID,
        reservation_id: RESERVATION_ID,
        space_id: SPACE_ID,
        vehicle_plate: 'P123ABC',
        status: 'active',
        entry_at: new Date('2026-01-01T09:58:30.000Z'),
        exit_at: null,
        duration_seconds: null,
        created_at: timestamp,
        updated_at: timestamp
    });

    await repository.createOperation({
        id: OPERATION_ID,
        operationType: 'checkout_space',
        reservationId: RESERVATION_ID,
        sessionId: SESSION_ID,
        spaceId: SPACE_ID,
        payload: {
            sessionId: SESSION_ID,
            reservationId: RESERVATION_ID,
            spaceId: SPACE_ID,
            exitAt: '2026-01-01T10:00:00.000Z',
            durationSeconds: 90
        },
        owner: 'api-que-fallo',
        maxAttempts: 3
    });

    expireLease(clock);
    assert.equal(await worker.runOnce(), true);

    const session = await repository.findSessionById(SESSION_ID);
    assert.equal(session.status, 'completed');
    assert.equal(session.duration_seconds, 90);
    assert.equal((await repository.findReservationById(RESERVATION_ID)).status, 'completed');
    assert.equal(repository.operations.get(OPERATION_ID).status, 'completed');
});

test('reprograma operaciones con errores transitorios y luego las completa', async () => {
    const { clock, repository, parkingClient, worker } = createContext();
    parkingClient.addSpace(SPACE_ID);
    parkingClient.failGetSpace = new ParkingServiceError('unavailable', 'sin conexión');

    await repository.createOperation({
        id: OPERATION_ID,
        operationType: 'reserve_space',
        reservationId: RESERVATION_ID,
        spaceId: SPACE_ID,
        payload: { vehiclePlate: 'P123ABC' },
        owner: 'api-que-fallo',
        maxAttempts: 3
    });

    expireLease(clock);
    assert.equal(await worker.runOnce(), true);

    const retried = repository.operations.get(OPERATION_ID);
    assert.equal(retried.status, 'pending');
    assert.equal(retried.attempts, 2);
    assert.match(retried.last_error, /sin conexión/);

    parkingClient.failGetSpace = null;
    clock.value = new Date(new Date(retried.next_attempt_at).getTime() + 1);
    assert.equal(await worker.runOnce(), true);

    assert.equal(repository.operations.get(OPERATION_ID).status, 'completed');
    assert.equal((await repository.findReservationById(RESERVATION_ID)).status, 'confirmed');
});

test('descarta una reserva cuando la plaza pertenece a otra reserva', async () => {
    const { clock, repository, parkingClient, worker } = createContext();
    parkingClient.addSpace(SPACE_ID, {
        status: 'reserved',
        reservedByReservationId: OTHER_RESERVATION_ID
    });

    await repository.createOperation({
        id: OPERATION_ID,
        operationType: 'reserve_space',
        reservationId: RESERVATION_ID,
        spaceId: SPACE_ID,
        payload: { vehiclePlate: 'P123ABC' },
        owner: 'api-que-fallo',
        maxAttempts: 3
    });

    expireLease(clock);
    assert.equal(await worker.runOnce(), true);

    assert.equal(repository.operations.get(OPERATION_ID).status, 'failed');
    assert.equal(await repository.findReservationById(RESERVATION_ID), null);
});
