require('./config');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const MIGRATION_FILES = [
    '001_init.sql',
    '002_reconciliation_operations.sql'
];

async function ensureSchema() {
    for (const file of MIGRATION_FILES) {
        const sql = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
        await pool.query(sql);
    }
}

if (require.main === module) {
    ensureSchema()
        .then(() => {
            console.log('Esquema reservations creado/verificado correctamente.');
            return pool.end();
        })
        .catch((error) => {
            console.error(`No se pudo aplicar el esquema reservations: ${error.message}`);
            process.exitCode = 1;
            return pool.end();
        });
}

module.exports = { ensureSchema };
