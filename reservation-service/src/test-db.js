
const pool = require('./db');

async function testConnection() {
    try {
        const result = await pool.query(`
            SELECT
                current_database() AS database,
                NOW() AS connected_at
        `);

        console.log('Conexión de reservation-service exitosa');
        console.log(result.rows[0]);
    } catch (error) {
        console.error('Error de conexión:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

testConnection();
