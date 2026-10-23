require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';

function proxyOptions(target, prefix) {
    return {
        target,
        changeOrigin: true,
        pathRewrite: { [`^${prefix}`]: '' },
        on: {
            proxyReq: (proxyReq) => {
                if (INTERNAL_API_TOKEN) {
                    proxyReq.setHeader('x-internal-token', INTERNAL_API_TOKEN);
                } else {
                    proxyReq.removeHeader('x-internal-token');
                }
            }
        }
    };
}

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        service: 'api-gateway',
        status: 'ok'
    });
});

app.use((req, res, next) => {
    delete req.headers['x-internal-token'];
    next();
});

app.use(
    '/api/parking',
    createProxyMiddleware(proxyOptions(
        process.env.PARKING_SERVICE_URL || 'http://localhost:3001',
        '/api/parking'
    ))
);

app.use(
    '/api/reservations',
    createProxyMiddleware(proxyOptions(
        process.env.RESERVATION_SERVICE_URL || 'http://localhost:3002',
        '/api/reservations'
    ))
);

app.use(
    '/api/payments',
    createProxyMiddleware(proxyOptions(
        process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
        '/api/payments'
    ))
);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway ejecutándose en el puerto ${PORT}`);
});
