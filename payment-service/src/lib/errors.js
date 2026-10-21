const CODES = Object.freeze({
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_ID: 'INVALID_ID',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
    PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
    DATABASE_ERROR: 'DATABASE_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
});

class AppError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function errorBody(code, message, details, requestId) {
    return {
        error: {
            code,
            message,
            details: details === undefined ? null : details,
            requestId
        }
    };
}

function notFoundHandler(req, res) {
    res.status(404).json(
        errorBody(
            CODES.RESOURCE_NOT_FOUND,
            `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
            null,
            req.requestId
        )
    );
}

function errorHandler(err, req, res, _next) {
    if (res.headersSent) return;

    if (err instanceof AppError) {
        console.error(
            `[${req.requestId}] ${req.method} ${req.originalUrl} -> ${err.status} ${err.code}: ${err.message}`
        );
        return res.status(err.status).json(errorBody(err.code, err.message, err.details, req.requestId));
    }

    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
        return res.status(400).json(
            errorBody(CODES.VALIDATION_ERROR, 'El cuerpo de la solicitud no contiene JSON válido.', null, req.requestId)
        );
    }

    console.error(`[${req.requestId}] Error interno:`, err && err.stack ? err.stack : err);
    res.status(500).json(errorBody(CODES.INTERNAL_ERROR, 'Error interno del servidor.', null, req.requestId));
}

module.exports = { CODES, AppError, errorBody, notFoundHandler, errorHandler };
