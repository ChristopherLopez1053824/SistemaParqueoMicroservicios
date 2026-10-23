require('./config');
const express = require('express');

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
