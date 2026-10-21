// Todas las llamadas pasan por el API Gateway.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
    constructor({ status, code, message, details = null, requestId = null }) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.requestId = requestId;
    }
}

const FALLBACK_MESSAGES = {
    502: 'El servicio no respondió correctamente. Intente de nuevo en unos momentos.',
    503: 'El servicio no está disponible temporalmente.',
    504: 'El servicio tardó demasiado en responder.'
};
const GENERIC_MESSAGE = 'Ocurrió un error al procesar la solicitud. Intente de nuevo.';

function fallbackCode(status) {
    if (status >= 502 && status <= 504) return 'SERVICE_UNAVAILABLE';
    return 'INTERNAL_ERROR';
}

export async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
    } catch (err) {
        const timedOut = err.name === 'AbortError';
        throw new ApiError({
            status: 0,
            code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
            message: timedOut
                ? 'La solicitud excedió el tiempo de espera. Puede haberse procesado; verifique el estado antes de repetirla.'
                : 'No se pudo conectar con el API Gateway.'
        });
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 204) return null;

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const error = payload?.error;
        throw new ApiError({
            status: response.status,
            code: error?.code || fallbackCode(response.status),
            message: error?.message || FALLBACK_MESSAGES[response.status] || GENERIC_MESSAGE,
            details: error?.details ?? null,
            requestId: error?.requestId ?? null
        });
    }

    if (!payload || !('data' in payload)) {
        throw new ApiError({
            status: response.status,
            code: 'INVALID_RESPONSE',
            message: 'La respuesta del servidor no tiene el formato oficial ({ "data": ... }).'
        });
    }

    return payload;
}
