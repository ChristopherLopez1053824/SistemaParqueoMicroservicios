const { randomUUID } = require('crypto');
const { AppError, ERROR_CODES } = require('../lib/errors');

function asyncHandler(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function notFoundHandler(req, res, next) {
    next(new AppError(
        404,
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `La ruta ${req.method} ${req.originalUrl} no existe.`
    ));
}

const UNAVAILABLE_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '08P01',
    '53300',
    '53400',
    '57P01',
    '57P02',
    '57P03'
]);

function isDatabaseError(error) {
    return Boolean(error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code));
}

function isUnavailableError(error) {
    return Boolean(error && UNAVAILABLE_ERROR_CODES.has(error.code));
}

function createErrorHandler(logger = console) {
    return (error, req, res, next) => {
        const requestId = req.requestId || randomUUID();

        if (res.headersSent) {
            return next(error);
        }

        if (!req.requestId) {
            res.set('x-request-id', requestId);
        }

        let statusCode = 500;
        let code = ERROR_CODES.INTERNAL_ERROR;
        let message = 'Ocurrió un error interno inesperado.';
        let details = null;

        if (error instanceof AppError) {
            statusCode = error.statusCode;
            code = error.code;
            message = error.message;
            details = error.details || null;
        } else if (error && (error.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400))) {
            statusCode = 400;
            code = ERROR_CODES.VALIDATION_ERROR;
            message = 'El cuerpo JSON de la solicitud no es válido.';
        } else if (error && error.type === 'entity.too.large') {
            statusCode = 400;
            code = ERROR_CODES.VALIDATION_ERROR;
            message = 'El cuerpo de la solicitud es demasiado grande.';
        } else if (isUnavailableError(error)) {
            statusCode = 503;
            code = ERROR_CODES.SERVICE_UNAVAILABLE;
            message = 'La base de datos no está disponible en este momento.';
        } else if (isDatabaseError(error)) {
            statusCode = 500;
            code = ERROR_CODES.DATABASE_ERROR;
            message = 'No se pudo completar la operación en la base de datos.';
        }

        if (statusCode >= 500) {
            logger.error(`[${requestId}] ${code}: ${error?.message || 'Error desconocido'}`);
        }

        res.status(statusCode).json({
            error: {
                code,
                message,
                details,
                requestId
            }
        });
    };
}

module.exports = {
    asyncHandler,
    notFoundHandler,
    createErrorHandler
};
