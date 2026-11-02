// Valores oficiales del contrato (sección 3.3) con su etiqueta en pantalla.
export const SPACE_STATUS_LABELS = {
    available: 'Disponible',
    reserved: 'Reservada',
    occupied: 'Ocupada',
    maintenance: 'Mantenimiento'
};

export const SPACE_TYPE_LABELS = {
    standard: 'Estándar',
    accessible: 'Accesible',
    electric: 'Eléctrica'
};

export const RESERVATION_STATUS_LABELS = {
    confirmed: 'Confirmada',
    cancelled: 'Cancelada',
    completed: 'Completada'
};

export const SESSION_STATUS_LABELS = {
    active: 'Activa',
    completed: 'Completada',
    cancelled: 'Cancelada'
};

export const PAYMENT_STATUS_LABELS = {
    pending: 'Pendiente',
    succeeded: 'Simulación confirmada',
    failed: 'Fallido'
};

// Etiqueta para el estado de pago de una sesión en las pantallas de
// entrada/salida y cobro: solo interesa distinguir PAGADA de PENDIENTE,
// sin importar si el pago no existe, está pendiente o falló.
export const SESSION_PAYMENT_LABELS = {
    succeeded: 'Pagada',
    pending: 'Pendiente de pago'
};
