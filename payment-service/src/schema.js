require('./config');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const SQL_FILE = path.join(__dirname, '../sql/01_payments_schema.sql');

async function ensureSchema() {
    const sql = fs.readFileSync(SQL_FILE, 'utf8');
    await pool.query(sql);
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
