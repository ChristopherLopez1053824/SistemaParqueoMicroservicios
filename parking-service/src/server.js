require('./config');
const express = require('express');
const { randomUUID } = require('crypto');
const parkingRoutes = require('./routes/parking.routes');
const { notFoundHandler, errorHandler } = require('./lib/errors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
});

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'parking-service',
        status: 'ok'
    });
});

app.use('/', parkingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Parking Service ejecutándose en el puerto ${PORT}`);
    });
}

module.exports = app;
