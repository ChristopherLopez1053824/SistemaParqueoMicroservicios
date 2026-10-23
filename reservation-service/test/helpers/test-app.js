const { createApp } = require('../../src/app');
const { ReservationService } = require('../../src/services/reservation-service');
const { FakeReservationRepository, FakeParkingClient } = require('./fakes');

const silentLogger = {
    info() {},
    warn() {},
    error() {},
    log() {}
};

function createTestContext(options = {}) {
    const clock = {
        value: options.now ? new Date(options.now) : new Date('2026-01-01T10:00:00.000Z')
    };

    const repository = new FakeReservationRepository({
        currentTime: () => new Date(clock.value)
    });
    const parkingClient = new FakeParkingClient({
        currentTime: () => new Date(clock.value)
    });

    const reservationService = new ReservationService({
        repository,
        parkingClient,
        logger: silentLogger,
        now: () => new Date(clock.value)
    });

    const app = createApp({
        reservationService,
        logger: silentLogger
    });

    return {
        app,
        clock,
        repository,
        parkingClient,
        reservationService
    };
}

async function startServer(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function stopServer(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function request(server, method, path, { body, rawBody, headers = {} } = {}) {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
            ...(body !== undefined || rawBody !== undefined ? { 'content-type': 'application/json' } : {}),
            ...headers
        },
        body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let payload = null;

    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (error) {
            payload = text;
        }
    }

    return {
        status: response.status,
        headers: response.headers,
        body: payload
    };
}

module.exports = {
    createTestContext,
    startServer,
    stopServer,
    request,
    silentLogger
};
