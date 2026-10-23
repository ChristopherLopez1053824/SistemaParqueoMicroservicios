const pool = require('../db');
const { AppError, CODES } = require('./errors');

async function query(text, params) {
    try {
        return await pool.query(text, params);
    } catch (error) {
        console.error(`DATABASE_ERROR: ${error.message}`);
        throw new AppError(500, CODES.DATABASE_ERROR, 'Error interno de base de datos.');
    }
}

module.exports = { query };
