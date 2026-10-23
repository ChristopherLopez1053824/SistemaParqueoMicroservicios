class ParkingServiceError extends Error {
    constructor(kind, message, options = {}) {
        super(message);
        this.name = 'ParkingServiceError';
        this.kind = kind;
        this.upstreamStatus = options.upstreamStatus || null;
        this.upstreamCode = options.upstreamCode || null;
        if (options.cause) {
            this.cause = options.cause;
        }
    }
}

function kindFromStatus(status) {
    if (status === 404) return 'not_found';
    if (status === 409) return 'conflict';
    if (status === 408 || status === 504) return 'timeout';
    if (status >= 500) return 'server';
    return 'bad_response';
}

class ParkingClient {
    constructor({ baseUrl, timeoutMs = 3000, internalApiToken = null }) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
        this.internalApiToken = internalApiToken || null;
    }

    async _request(method, path, { body, requestId } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    accept: 'application/json',
                    ...(body ? { 'content-type': 'application/json' } : {}),
                    ...(requestId ? { 'x-request-id': requestId } : {}),
                    ...(this.internalApiToken ? { 'x-internal-token': this.internalApiToken } : {})
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            const rawBody = await response.text();
            let payload = null;

            if (rawBody) {
                try {
                    payload = JSON.parse(rawBody);
                } catch (error) {
                    throw new ParkingServiceError(
                        'bad_response',
                        'Parking Service devolvió una respuesta JSON inválida.',
                        { upstreamStatus: response.status, cause: error }
                    );
                }
            }

            if (!response.ok) {
                throw new ParkingServiceError(
                    kindFromStatus(response.status),
                    payload?.error?.message || `Parking Service respondió con el código ${response.status}.`,
                    {
                        upstreamStatus: response.status,
                        upstreamCode: payload?.error?.code || null
                    }
                );
            }

            if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
                throw new ParkingServiceError(
                    'bad_response',
                    'Parking Service devolvió una respuesta con un formato inesperado.',
                    { upstreamStatus: response.status }
                );
            }

            return payload.data;
        } catch (error) {
            if (error instanceof ParkingServiceError) {
                throw error;
            }

            if (error.name === 'AbortError') {
                throw new ParkingServiceError(
                    'timeout',
                    'Parking Service no respondió dentro del tiempo esperado.',
                    { cause: error }
                );
            }

            throw new ParkingServiceError(
                'unavailable',
                'No fue posible establecer comunicación con Parking Service.',
                { cause: error }
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    getSpace(spaceId, requestId) {
        return this._request('GET', `/spaces/${encodeURIComponent(spaceId)}`, { requestId });
    }

    reserveSpace(spaceId, reservationId, requestId) {
        return this._request('POST', `/spaces/${encodeURIComponent(spaceId)}/reserve`, {
            body: { reservationId },
            requestId
        });
    }

    occupySpace(spaceId, reservationId, requestId) {
        return this._request('POST', `/spaces/${encodeURIComponent(spaceId)}/occupy`, {
            body: { reservationId },
            requestId
        });
    }

    releaseSpace(spaceId, reservationId, requestId) {
        return this._request('POST', `/spaces/${encodeURIComponent(spaceId)}/release`, {
            body: { reservationId },
            requestId
        });
    }

    checkoutSpace(spaceId, reservationId, requestId) {
        return this._request('POST', `/spaces/${encodeURIComponent(spaceId)}/checkout`, {
            body: { reservationId },
            requestId
        });
    }

    restoreSpace(spaceId, reservationId, requestId) {
        return this._request('POST', `/spaces/${encodeURIComponent(spaceId)}/restore`, {
            body: { reservationId },
            requestId
        });
    }
}

module.exports = {
    ParkingClient,
    ParkingServiceError
};
