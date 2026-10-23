const express = require('express');
const { asyncHandler } = require('../middleware/common');

function createReservationsRouter(reservationService) {
    const router = express.Router();

    router.post('/', asyncHandler(async (req, res) => {
        const reservation = await reservationService.createReservation(req.body, {
            requestId: req.requestId
        });
        res.status(201).json({ data: reservation });
    }));

    router.get('/', asyncHandler(async (req, res) => {
        const reservations = await reservationService.listReservations();
        res.status(200).json({
            data: reservations,
            meta: { total: reservations.length }
        });
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const reservation = await reservationService.getReservation(req.params.id);
        res.status(200).json({ data: reservation });
    }));

    router.patch('/:id/cancel', asyncHandler(async (req, res) => {
        const reservation = await reservationService.cancelReservation(req.params.id, {
            requestId: req.requestId
        });
        res.status(200).json({ data: reservation });
    }));

    return router;
}

module.exports = { createReservationsRouter };
