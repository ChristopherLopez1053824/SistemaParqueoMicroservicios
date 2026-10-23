const config = require('./config');
const { createApp } = require('./app');

const app = createApp(config);

const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`API Gateway ejecutándose en el puerto ${config.port}`);
    console.log(`Parking: ${config.services.parking}`);
    console.log(`Reservations: ${config.services.reservation}`);
    console.log(`Payments: ${config.services.payment}`);
});

function shutdown(signal) {
    console.log(`API Gateway recibió ${signal}. Cerrando...`);
    server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
