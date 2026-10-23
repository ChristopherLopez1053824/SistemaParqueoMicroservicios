const SPACE_STATUSES = Object.freeze([
    'available',
    'reserved',
    'occupied',
    'maintenance'
]);

const SPACE_TYPES = Object.freeze([
    'standard',
    'accessible',
    'electric'
]);

const DEFAULT_SPACE_TYPE = 'standard';

// Modelo teórico completo de transiciones. Documenta el estado deseado, pero
// "reserved" y "occupied" solo deben alcanzarse a través de los endpoints
// dedicados (/reserve, /occupy, /release, /checkout, /restore), que validan
// la reserva propietaria. Ver ADMIN_ASSIGNABLE_TRANSITIONS más abajo.
const ALLOWED_TRANSITIONS = Object.freeze({
    available: Object.freeze(['reserved', 'occupied', 'maintenance']),
    reserved: Object.freeze(['occupied', 'available']),
    occupied: Object.freeze(['available']),
    maintenance: Object.freeze(['available'])
});

// Transiciones que el endpoint administrativo genérico (PATCH /spaces/:id/status)
// puede aplicar directamente, sin un reservationId. Deliberadamente excluye
// "reserved" y "occupied": asignarlos u liberarlos sin pasar por el flujo de
// reservas rompería el invariante "reserved/occupied siempre tiene un dueño"
// y permitiría liberar una plaza todavía ocupada sin que Reservation Service
// se enterara.
const ADMIN_ASSIGNABLE_TRANSITIONS = Object.freeze({
    available: Object.freeze(['maintenance']),
    maintenance: Object.freeze(['available'])
});

module.exports = {
    SPACE_STATUSES,
    SPACE_TYPES,
    DEFAULT_SPACE_TYPE,
    ALLOWED_TRANSITIONS,
    ADMIN_ASSIGNABLE_TRANSITIONS
};
