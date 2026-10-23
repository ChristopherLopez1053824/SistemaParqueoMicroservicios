const { timingSafeEqual } = require('crypto');
const { AppError, ERROR_CODES } = require('../lib/errors');

function tokensMatch(provided, expected) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    return providedBuffer.length === expectedBuffer.length
        && timingSafeEqual(providedBuffer, expectedBuffer);
}

function createInternalAuth(expectedToken) {
    if (!expectedToken) {
        return (req, res, next) => next();
    }

    return (req, res, next) => {
        const providedToken = req.get('x-internal-token') || '';

        if (!tokensMatch(providedToken, expectedToken)) {
            next(new AppError(
                401,
                ERROR_CODES.UNAUTHORIZED,
                'El token interno de la solicitud no es válido.'
            ));
            return;
        }

        next();
    };
}

module.exports = { createInternalAuth };
