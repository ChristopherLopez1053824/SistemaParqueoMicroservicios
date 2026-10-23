const { randomUUID } = require('crypto');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROXY_ERRORS = {
    502: {
        code: 'BAD_GATEWAY',
        message: 'El microservicio devolvió una respuesta inválida o cerró la conexión.'
    },
    503: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'El microservicio no está disponible en este momento.'
    },
    504: {
        code: 'GATEWAY_TIMEOUT',
        message: 'El microservicio no respondió dentro del tiempo esperado.'
    }
};

function errorBody(code, message, requestId) {
    return {
        error: {
            code,
            message,
            details: null,
            requestId
        }
    };
}

function sendError(res, requestId, status, code, message) {
    if (res.headersSent) return;
    res.status(status).json(errorBody(code, message, requestId));
}

function normalizeTarget(target) {
    return String(target).replace(/\/+$/, '');
}

function createCorsMiddleware(origins) {
    const allowed = new Set(origins);

    return (req, res, next) => {
        const origin = req.get('origin');

        if (origin && (allowed.has('*') || allowed.has(origin))) {
            res.setHeader('Access-Control-Allow-Origin', allowed.has('*') ? '*' : origin);
            if (!allowed.has('*')) {
                res.setHeader('Vary', 'Origin');
            }
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Accept,Content-Type,Idempotency-Key,x-request-id'
            );
            res.setHeader('Access-Control-Expose-Headers', 'x-request-id');
            res.setHeader('Access-Control-Max-Age', '600');
        }

        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }

        next();
    };
}

function proxyErrorStatus(err, req) {
    if (req.gatewayTimedOut || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(err && err.code)) {
        return 504;
    }

    if (
        err &&
        ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.code)
    ) {
        return 503;
    }

    return 502;
}

function rewriteReservationPath(path) {
    const [pathname, search = ''] = path.split('?');
    let rewritten;

    if (pathname === '' || pathname === '/') {
        rewritten = '/reservations';
    } else if (pathname === '/sessions' || pathname.startsWith('/sessions/')) {
        rewritten = pathname;
    } else {
        rewritten = `/reservations${pathname}`;
    }

    return search ? `${rewritten}?${search}` : rewritten;
}

function createServiceProxy({
    name,
    target,
    internalApiToken,
    proxyTimeoutMs,
    logger,
    pathRewrite
}) {
    return createProxyMiddleware({
        target: normalizeTarget(target),
        changeOrigin: true,
        proxyTimeout: proxyTimeoutMs,
        ...(pathRewrite ? { pathRewrite } : {}),
        on: {
            proxyReq(proxyReq, req) {
                proxyReq.setHeader('x-request-id', req.requestId);

                if (internalApiToken) {
                    proxyReq.setHeader('x-internal-token', internalApiToken);
                } else {
                    proxyReq.removeHeader('x-internal-token');
                }
            },
            proxyRes(proxyRes, req, res) {
                proxyRes.headers['x-request-id'] = req.requestId;
                res.setHeader('x-request-id', req.requestId);
            },
            error(err, req, res) {
                const status = proxyErrorStatus(err, req);
                const { code, message } = PROXY_ERRORS[status];

                logger.error(
                    `[${req.requestId}] Error de comunicación con ${name}: ${err && err.code ? err.code : err}`
                );

                sendError(res, req.requestId, status, code, message);
            }
        }
    });
}

async function checkDependency(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${url}/health`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });

        return response.ok ? 'up' : 'down';
    } catch {
        return 'down';
    } finally {
        clearTimeout(timer);
    }
}

function createApp({
    services,
    internalApiToken = '',
    corsOrigins = ['http://localhost:5173'],
    proxyTimeoutMs = 10000,
    healthTimeoutMs = 2000,
    logger = console
} = {}) {
    const app = express();
    const targets = {
        parking: normalizeTarget(services.parking),
        reservation: normalizeTarget(services.reservation),
        payment: normalizeTarget(services.payment)
    };

    app.disable('x-powered-by');

    app.use((req, res, next) => {
        const incoming = req.get('x-request-id');
        req.requestId = UUID_PATTERN.test(incoming || '') ? incoming : randomUUID();
        req.headers['x-request-id'] = req.requestId;
        delete req.headers['x-internal-token'];
        res.setHeader('x-request-id', req.requestId);

        req.gatewayTimedOut = false;
        const timeoutTimer = setTimeout(() => {
            req.gatewayTimedOut = true;
        }, proxyTimeoutMs);
        timeoutTimer.unref();

        const clearTimer = () => clearTimeout(timeoutTimer);
        res.on('finish', clearTimer);
        res.on('close', clearTimer);

        next();
    });

    app.use(createCorsMiddleware(corsOrigins));

    app.get('/health', (req, res) => {
        res.status(200).json({
            service: 'api-gateway',
            status: 'ok'
        });
    });

    app.get('/health/dependencies', async (req, res) => {
        const entries = await Promise.all(
            Object.entries(targets).map(async ([name, url]) => [
                name,
                { status: await checkDependency(url, healthTimeoutMs) }
            ])
        );
        const dependencies = Object.fromEntries(entries);
        const healthy = Object.values(dependencies).every((dependency) => dependency.status === 'up');

        res.status(healthy ? 200 : 503).json({
            service: 'api-gateway',
            status: healthy ? 'ok' : 'degraded',
            dependencies
        });
    });

    const proxyOptions = {
        internalApiToken,
        proxyTimeoutMs,
        logger
    };

    app.use('/api/parking', createServiceProxy({
        name: 'parking-service',
        target: targets.parking,
        ...proxyOptions
    }));

    app.use('/api/reservations', createServiceProxy({
        name: 'reservation-service',
        target: targets.reservation,
        pathRewrite: rewriteReservationPath,
        ...proxyOptions
    }));

    app.use('/api/payments', createServiceProxy({
        name: 'payment-service',
        target: targets.payment,
        ...proxyOptions
    }));

    app.use((req, res) => {
        sendError(
            res,
            req.requestId,
            404,
            'RESOURCE_NOT_FOUND',
            `La ruta ${req.method} ${req.originalUrl} no existe en el API Gateway.`
        );
    });

    app.use((err, req, res, _next) => {
        logger.error(`[${req.requestId}] Error interno del Gateway: ${err && err.stack ? err.stack : err}`);
        sendError(res, req.requestId, 500, 'INTERNAL_ERROR', 'Error interno del API Gateway.');
    });

    return app;
}

module.exports = {
    createApp,
    createCorsMiddleware,
    proxyErrorStatus,
    errorBody
};
