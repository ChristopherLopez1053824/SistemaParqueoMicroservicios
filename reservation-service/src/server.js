const config = require('./config');
const pool = require('./db');
const { createApp } = require('./app');
const { ReservationRepository } = require('./repositories/reservation-repository');
const { ParkingClient } = require('./http/parking-client');
const { ReservationService } = require('./services/reservation-service');

const repository = new ReservationRepository(pool);
const parkingClient = new ParkingClient({
    baseUrl: config.parkingServiceUrl,
    timeoutMs: config.parkingServiceTimeoutMs
});
const reservationService = new ReservationService({ repository, parkingClient });

const app = createApp({
    reservationService,
    bodyLimit: config.bodyLimit
});

pool.on('error', (error) => {
    console.error('Error inesperado en el pool de PostgreSQL:', error.message);
});

const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Reservation Service ejecutándose en el puerto ${config.port}`);
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
