require('dotenv').config();

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
    port: toPositiveInt(process.env.PORT, 3002),
    parkingServiceUrl: (process.env.PARKING_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, ''),
    parkingServiceTimeoutMs: toPositiveInt(process.env.PARKING_SERVICE_TIMEOUT_MS, 3000),
    bodyLimit: process.env.BODY_LIMIT || '100kb'
};
