
const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/spaces', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, code, level, space_type, status
            FROM parking.parking_spaces
            ORDER BY code
        `);

        res.json({
            total: result.rowCount,
            spaces: result.rows
        });
    } catch (error) {
        console.error('Error al consultar las plazas:', error.message);

        res.status(500).json({
            error: 'No se pudieron consultar las plazas de estacionamiento'
        });
    }
});

module.exports = router;
