const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../../.env'), override: false, quiet: true });

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toOriginList(value) {
    return String(value || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

module.exports = {
    port: toPositiveInt(process.env.PORT || process.env.API_GATEWAY_PORT, 3000),
    services: {
        parking: process.env.PARKING_SERVICE_URL || 'http://localhost:3001',
        reservation: process.env.RESERVATION_SERVICE_URL || 'http://localhost:3002',
        payment: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003'
    },
    internalApiToken: process.env.INTERNAL_API_TOKEN || '',
    proxyTimeoutMs: toPositiveInt(process.env.PROXY_TIMEOUT_MS, 10000),
    healthTimeoutMs: toPositiveInt(process.env.HEALTH_TIMEOUT_MS, 2000),
    corsOrigins: toOriginList(process.env.CORS_ORIGINS)
};
