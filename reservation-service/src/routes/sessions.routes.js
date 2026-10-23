const express = require('express');
const { asyncHandler } = require('../middleware/common');

function createSessionsRouter(reservationService) {
    const router = express.Router();

    router.post('/:reservationId/entry', asyncHandler(async (req, res) => {
        const session = await reservationService.registerEntry(req.params.reservationId, {
            requestId: req.requestId
        });
        res.status(201).json({ data: session });
    }));

    router.post('/:sessionId/exit', asyncHandler(async (req, res) => {
        const session = await reservationService.registerExit(req.params.sessionId, {
            requestId: req.requestId
        });
        res.status(200).json({ data: session });
    }));

    router.get('/:sessionId', asyncHandler(async (req, res) => {
        const session = await reservationService.getSession(req.params.sessionId);
        res.status(200).json({ data: session });
    }));

    return router;
}

module.exports = { createSessionsRouter };
