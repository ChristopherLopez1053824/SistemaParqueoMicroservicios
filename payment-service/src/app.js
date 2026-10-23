const { randomUUID } = require('crypto');
const express = require('express');
const paymentRoutes = require('./routes/payment.routes');
const { notFoundHandler, errorHandler } = require('./lib/errors');
const { createInternalAuth } = require('./middleware/internal-auth');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createApp({
    bodyLimit = process.env.BODY_LIMIT || '100kb',
    internalApiToken = process.env.INTERNAL_API_TOKEN || ''
} = {}) {
    const app = express();

    app.disable('x-powered-by');

    app.use((req, res, next) => {
        const incoming = req.get('x-request-id');
        req.requestId = UUID_PATTERN.test(incoming || '') ? incoming : randomUUID();
        res.setHeader('x-request-id', req.requestId);
        next();
    });

    app.use(express.json({ limit: bodyLimit }));

    app.get('/health', (req, res) => {
        res.status(200).json({
            service: 'payment-service',
            status: 'ok'
        });
    });

    app.use(createInternalAuth(internalApiToken));

    // Rutas internas: /payments/... (contrato seccion 3.7) y /... (compatibilidad
    // con la reescritura de prefijos del API Gateway: ^/api/payments -> '')
    app.use('/payments', paymentRoutes);
    app.use('/', paymentRoutes);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
