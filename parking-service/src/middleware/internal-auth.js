const { randomUUID, timingSafeEqual } = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

        if (tokensMatch(providedToken, expectedToken)) {
            next();
            return;
        }

        const incoming = req.get('x-request-id');
        const requestId = UUID_PATTERN.test(incoming || '') ? incoming : randomUUID();
        res.set('x-request-id', requestId);
        res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'El token interno de la solicitud no es válido.',
                details: null,
                requestId
            }
        });
    };
}

module.exports = { createInternalAuth };
