const { randomUUID } = require('crypto');
const { isUuid } = require('../lib/uuid');

function requestContext(logger = console) {
    return (req, res, next) => {
        const incoming = req.get('x-request-id');
        req.requestId = isUuid(incoming) ? incoming : randomUUID();
        res.set('x-request-id', req.requestId);

        res.on('finish', () => {
            const log = logger.info || logger.log;
            if (typeof log === 'function') {
                log.call(logger, `[${req.requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
            }
        });

        next();
    };
}

module.exports = { requestContext };
