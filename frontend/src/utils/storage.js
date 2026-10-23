// Comodidades locales del navegador: sesiones recientes y claves de idempotencia pendientes.
// Si el almacenamiento no está disponible, la aplicación sigue funcionando.
function read(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Sin almacenamiento disponible.
    }
}

const SESSIONS_KEY = 'parking.recentSessions';
const IDEMPOTENCY_KEYS = 'parking.pendingIdempotencyKeys';

export function getRecentSessions() {
    return read(SESSIONS_KEY, []);
}

export function rememberSession({ sessionId, ticketNumber, reservationId, vehiclePlate }) {
    const others = getRecentSessions().filter((s) => s.sessionId !== sessionId);
    write(SESSIONS_KEY, [{ sessionId, ticketNumber, reservationId, vehiclePlate }, ...others].slice(0, 10));
}

// La clave se guarda por quoteId para reutilizarla si el intento se reintenta,
// incluso después de recargar la página.
export function getPendingIdempotencyKey(quoteId) {
    return read(IDEMPOTENCY_KEYS, {})[quoteId] || null;
}

export function setPendingIdempotencyKey(quoteId, key) {
    const all = read(IDEMPOTENCY_KEYS, {});
    if (key) all[quoteId] = key;
    else delete all[quoteId];
    write(IDEMPOTENCY_KEYS, all);
}
