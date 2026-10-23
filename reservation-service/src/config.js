const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../../.env'), override: false, quiet: true });

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoolean(value, fallback) {
    if (value === undefined || value === '') {
        return fallback;
    }
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

module.exports = {
    port: toPositiveInt(process.env.PORT, 3002),
    parkingServiceUrl: (process.env.PARKING_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, ''),
    parkingServiceTimeoutMs: toPositiveInt(process.env.PARKING_SERVICE_TIMEOUT_MS, 3000),
    bodyLimit: process.env.BODY_LIMIT || '100kb',
    internalApiToken: process.env.INTERNAL_API_TOKEN || null,
    reconciliation: {
        enabled: toBoolean(process.env.RECONCILIATION_WORKER_ENABLED, true),
        pollIntervalMs: toPositiveInt(process.env.RECONCILIATION_POLL_INTERVAL_MS, 2000),
        leaseSeconds: toPositiveInt(process.env.RECONCILIATION_LEASE_SECONDS, 60),
        retryBaseMs: toPositiveInt(process.env.RECONCILIATION_RETRY_BASE_MS, 1000),
        retryMaxMs: toPositiveInt(process.env.RECONCILIATION_RETRY_MAX_MS, 60000),
        maxAttempts: toPositiveInt(process.env.RECONCILIATION_MAX_ATTEMPTS, 10)
    },
    // Reservas programadas por franja horaria: ver migrations/004_scheduled_reservations.sql.
    scheduling: {
        maxAdvanceMinutes: toPositiveInt(process.env.RESERVATION_MAX_ADVANCE_MINUTES, 120),
        defaultDurationMinutes: toPositiveInt(process.env.RESERVATION_DEFAULT_DURATION_MINUTES, 240),
        minDurationMinutes: toPositiveInt(process.env.RESERVATION_MIN_DURATION_MINUTES, 15),
        maxDurationMinutes: toPositiveInt(process.env.RESERVATION_MAX_DURATION_MINUTES, 480)
    },
    expiration: {
        enabled: toBoolean(process.env.RESERVATION_EXPIRATION_ENABLED, true),
        pollIntervalMs: toPositiveInt(process.env.RESERVATION_EXPIRATION_POLL_INTERVAL_MS, 60000),
        graceMinutes: toPositiveInt(process.env.RESERVATION_NO_SHOW_GRACE_MINUTES, 30),
        batchSize: toPositiveInt(process.env.RESERVATION_EXPIRATION_BATCH_SIZE, 20)
    }
};
