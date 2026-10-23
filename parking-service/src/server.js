require('./config');
const { randomUUID } = require('crypto');
const express = require('express');
const parkingRoutes = require('./routes/parking.routes');
const { createInternalAuth } = require('./middleware/internal-auth');
const { notFoundHandler, errorHandler } = require('./lib/errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
const PORT = process.env.PORT || 3001;

app.disable('x-powered-by');

app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = UUID_PATTERN.test(incoming || '') ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
});

app.use(express.json({ limit: process.env.BODY_LIMIT || '100kb' }));

app.get('/health', (req, res) => {
    res.status(200).json({
        service: 'parking-service',
        status: 'ok'
    });
});

app.use(createInternalAuth(process.env.INTERNAL_API_TOKEN));

app.use('/', parkingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Parking Service ejecutándose en el puerto ${PORT}`);
    });
}

module.exports = app;
