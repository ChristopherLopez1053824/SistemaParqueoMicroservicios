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

const ALLOWED_TRANSITIONS = Object.freeze({
    available: Object.freeze(['reserved', 'occupied', 'maintenance']),
    reserved: Object.freeze(['occupied', 'available']),
    occupied: Object.freeze(['available']),
    maintenance: Object.freeze(['available'])
});

module.exports = {
    SPACE_STATUSES,
    SPACE_TYPES,
    DEFAULT_SPACE_TYPE,
    ALLOWED_TRANSITIONS
};
