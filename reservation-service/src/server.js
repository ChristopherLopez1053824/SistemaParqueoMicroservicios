const os = require('os');
const config = require('./config');
const pool = require('./db');
const { createApp } = require('./app');
const { ReservationRepository } = require('./repositories/reservation-repository');
const { ParkingClient } = require('./http/parking-client');
const { ReservationService } = require('./services/reservation-service');
const { ReconciliationService } = require('./services/reconciliation-service');
const { ExpirationService } = require('./services/expiration-service');

const instanceId = `${os.hostname()}:${process.pid}`;
const repository = new ReservationRepository(pool);
const parkingClient = new ParkingClient({
    baseUrl: config.parkingServiceUrl,
    timeoutMs: config.parkingServiceTimeoutMs,
    internalApiToken: config.internalApiToken
});
const reservationService = new ReservationService({
    repository,
    parkingClient,
    operationOwnerId: `${instanceId}:api`,
    reconciliationMaxAttempts: config.reconciliation.maxAttempts,
    reconciliationRetryBaseMs: config.reconciliation.retryBaseMs,
    maxAdvanceMinutes: config.scheduling.maxAdvanceMinutes,
    defaultDurationMinutes: config.scheduling.defaultDurationMinutes,
    minDurationMinutes: config.scheduling.minDurationMinutes,
    maxDurationMinutes: config.scheduling.maxDurationMinutes
});
const reconciliationService = new ReconciliationService({
    repository,
    parkingClient,
    workerId: `${instanceId}:worker`,
    pollIntervalMs: config.reconciliation.pollIntervalMs,
    leaseSeconds: config.reconciliation.leaseSeconds,
    retryBaseMs: config.reconciliation.retryBaseMs,
    retryMaxMs: config.reconciliation.retryMaxMs,
    maxAttempts: config.reconciliation.maxAttempts
});
const expirationService = new ExpirationService({
    repository,
    reservationService,
    pollIntervalMs: config.expiration.pollIntervalMs,
    graceMinutes: config.expiration.graceMinutes,
    batchSize: config.expiration.batchSize
});

const app = createApp({
    reservationService,
    bodyLimit: config.bodyLimit,
    internalApiToken: config.internalApiToken
});

pool.on('error', (error) => {
    console.error('Error inesperado en el pool de PostgreSQL:', error.message);
});

const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Reservation Service ejecutándose en el puerto ${config.port}`);

    if (config.reconciliation.enabled) {
        reconciliationService.start();
        console.log('Worker de reconciliación iniciado.');
    } else {
        console.log('Worker de reconciliación deshabilitado por configuración.');
    }

    if (config.expiration.enabled) {
        expirationService.start();
        console.log('Worker de expiración de reservas (no-show) iniciado.');
    } else {
        console.log('Worker de expiración de reservas deshabilitado por configuración.');
    }
});

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    console.log(`Reservation Service recibió ${signal}. Cerrando de forma ordenada...`);

    const forceExit = setTimeout(() => {
        console.error('No se pudo cerrar el servidor a tiempo.');
        process.exit(1);
    }, 10000);
    forceExit.unref();

    try {
        await reconciliationService.stop();
    } catch (error) {
        console.error('Error al detener el worker de reconciliación:', error.message);
    }

    try {
        await expirationService.stop();
    } catch (error) {
        console.error('Error al detener el worker de expiración de reservas:', error.message);
    }

    server.close(async () => {
        try {
            await pool.end();
            console.log('Reservation Service detenido.');
            process.exit(0);
        } catch (error) {
            console.error('Error al cerrar el pool de PostgreSQL:', error.message);
            process.exit(1);
        }
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
