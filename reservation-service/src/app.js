const express = require('express');
const { requestContext } = require('./middleware/request-context');
const { notFoundHandler, createErrorHandler } = require('./middleware/common');
const { createInternalAuth } = require('./middleware/internal-auth');
const { createReservationsRouter } = require('./routes/reservations.routes');
const { createSessionsRouter } = require('./routes/sessions.routes');

function createApp({
    reservationService,
    logger = console,
    bodyLimit = '100kb',
    internalApiToken = null
}) {
    const app = express();

    app.disable('x-powered-by');
    app.use(requestContext(logger));
    app.use(express.json({ limit: bodyLimit }));

    app.get('/health', (req, res) => {
        res.status(200).json({
            service: 'reservation-service',
            status: 'ok'
        });
    });

    app.use(createInternalAuth(internalApiToken));

    app.use('/reservations', createReservationsRouter(reservationService));
    app.use('/sessions', createSessionsRouter(reservationService));

    app.use(notFoundHandler);
    app.use(createErrorHandler(logger));

    return app;
}

module.exports = { createApp };
