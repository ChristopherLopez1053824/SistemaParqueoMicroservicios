class AppError extends Error {
    constructor(statusCode, code, message, details = null, options = {}) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.expose = options.expose !== false;
        if (options.cause) {
            this.cause = options.cause;
        }
    }
}

const ERROR_CODES = Object.freeze({
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_ID: 'INVALID_ID',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    SPACE_NOT_AVAILABLE: 'SPACE_NOT_AVAILABLE',
    RESERVATION_CONFLICT: 'RESERVATION_CONFLICT',
    INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
    SESSION_ALREADY_COMPLETED: 'SESSION_ALREADY_COMPLETED',
    DATABASE_ERROR: 'DATABASE_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
});

function validationError(details, message = 'Los datos enviados no son válidos.') {
    return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
}

function invalidId(field, message) {
    return new AppError(400, ERROR_CODES.INVALID_ID, message || `El campo ${field} no contiene un UUID válido.`, [
        { field, message: message || 'Debe ser un UUID válido.' }
    ]);
}

function notFound(message = 'El recurso solicitado no existe.') {
    return new AppError(404, ERROR_CODES.RESOURCE_NOT_FOUND, message);
}

function conflict(code, message, details = null) {
    return new AppError(409, code, message, details);
}

function serviceUnavailable(message = 'El servicio externo no está disponible en este momento.', options = {}) {
    return new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, message, null, options);
}

module.exports = {
    AppError,
    ERROR_CODES,
    validationError,
    invalidId,
    notFound,
    conflict,
    serviceUnavailable
};
