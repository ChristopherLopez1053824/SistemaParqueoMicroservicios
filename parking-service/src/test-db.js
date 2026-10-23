
const pool = require('./db');

async function testConnection() {
    try {
        const result = await pool.query(`
        SELECT
            current_database() AS database_name,
            current_user AS current_user,
            session_user AS session_user;
        `);


        console.log(result.rows);
    } catch (error) {
        console.error('Error al conectar con PostgreSQL:');
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

testConnection();
