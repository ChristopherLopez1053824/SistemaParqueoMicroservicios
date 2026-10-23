const pool = require('../db');
const { AppError, CODES } = require('./errors');

const UNAVAILABLE_PG_CODES = new Set([
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '57P01',
    '57P02',
    '57P03'
]);

const UNAVAILABLE_SYSTEM_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE'
]);

function isUnavailable(error) {
    return Boolean(
        error &&
        (UNAVAILABLE_PG_CODES.has(error.code) || UNAVAILABLE_SYSTEM_CODES.has(error.code))
    );
}

async function query(text, params) {
    try {
        return await pool.query(text, params);
    } catch (error) {
        console.error(`DATABASE_ERROR: ${error.message}`);

        const unavailable = isUnavailable(error);
        throw new AppError(
            unavailable ? 503 : 500,
            unavailable ? CODES.SERVICE_UNAVAILABLE : CODES.DATABASE_ERROR,
            unavailable
                ? 'El servicio de base de datos no está disponible temporalmente.'
                : 'Error interno de base de datos.'
        );
    }
}

module.exports = { query, isUnavailable };
