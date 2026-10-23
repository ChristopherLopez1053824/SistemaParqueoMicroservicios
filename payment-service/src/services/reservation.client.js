const { AppError, CODES } = require('../lib/errors');

function reservationBaseUrl() {
    return (process.env.RESERVATION_SERVICE_URL || 'http://localhost:3002').replace(/\/+$/, '');
}

function serviceUnavailable(error) {
    console.error(`Reservation Service inaccesible: ${error.message}`);
    return new AppError(503, CODES.SERVICE_UNAVAILABLE, 'El Reservation Service no está disponible en este momento.');
}

async function fetchSession(sessionId, requestId) {
    const configuredTimeout = Number(process.env.RESERVATION_SERVICE_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 5000;
    const internalApiToken = process.env.INTERNAL_API_TOKEN || null;
    const headers = {
        Accept: 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
        ...(internalApiToken ? { 'x-internal-token': internalApiToken } : {})
    };

    let response;
    try {
        response = await fetch(`${reservationBaseUrl()}/sessions/${sessionId}`, {
            headers,
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        throw serviceUnavailable(error);
    }

    if (response.status === 404) return null;

    if (!response.ok) {
        console.error(`Reservation Service respondió ${response.status} para la sesión ${sessionId}`);
        throw new AppError(
            503,
            CODES.SERVICE_UNAVAILABLE,
            'El Reservation Service no está disponible en este momento.'
        );
    }

    let body;
    try {
        body = await response.json();
    } catch (error) {
        throw serviceUnavailable(error);
    }

    const session = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;

    if (!session) return null;

    if (typeof session !== 'object' || !session.sessionId) {
        console.error('Reservation Service devolvió una sesión con formato inesperado.');
        throw new AppError(
            502,
            CODES.SERVICE_UNAVAILABLE,
            'El Reservation Service devolvió una respuesta inválida.'
        );
    }

    return session;
}

module.exports = { fetchSession };
