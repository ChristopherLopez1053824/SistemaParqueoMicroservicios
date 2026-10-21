require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'api-gateway',
        status: 'ok'
    });
});

app.use(
    '/api/parking',
    createProxyMiddleware({
        target: process.env.PARKING_SERVICE_URL || 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: { '^/api/parking': '' }
    })
);

app.use(
    '/api/reservations',
    createProxyMiddleware({
        target: process.env.RESERVATION_SERVICE_URL || 'http://localhost:3002',
        changeOrigin: true,
        pathRewrite: { '^/api/reservations': '' }
    })
);

app.use(
    '/api/payments',
    createProxyMiddleware({
        target: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
        changeOrigin: true,
        pathRewrite: { '^/api/payments': '' }
    })
);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway ejecutándose en el puerto ${PORT}`);
});
