require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const { randomUUID } = require('crypto');
const paymentRoutes = require('./routes/payment.routes');
const { notFoundHandler, errorHandler } = require('./lib/errors');
const { ensureSchema } = require('./schema');

const app = express();
const PORT = process.env.PORT || 3003;

app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
});

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'payment-service',
        status: 'ok'
    });
});

// Rutas internas: /payments/... (contrato seccion 3.7) y /... (compatibilidad
// con la reescritura de prefijos del API Gateway: ^/api/payments -> '')
app.use('/payments', paymentRoutes);
app.use('/', paymentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment Service ejecutándose en el puerto ${PORT}`);

    ensureSchema()
        .then(() => console.log('Esquema payments verificado.'))
        .catch((error) => console.warn(`No se pudo verificar el esquema payments: ${error.message}`));
});
