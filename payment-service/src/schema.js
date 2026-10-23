require('./config');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const MIGRATION_FILES = [
    '01_payments_schema.sql',
    '02_payments_retry_after_failure.sql'
];

async function ensureSchema() {
    for (const file of MIGRATION_FILES) {
        const sql = fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8');
        await pool.query(sql);
    }
}

if (require.main === module) {
    ensureSchema()
        .then(() => {
            console.log('Esquema payments creado/verificado correctamente.');
            return pool.end();
        })
        .catch((error) => {
            console.error(`No se pudo crear el esquema payments: ${error.message}`);
            process.exitCode = 1;
            return pool.end();
        });
}

module.exports = { ensureSchema };
