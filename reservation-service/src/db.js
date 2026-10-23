
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const ca = fs.readFileSync(
    path.join(__dirname, '../certs/supabase-ca.crt'),
    'utf8'
);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        ca,
        rejectUnauthorized: true
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

module.exports = pool;
