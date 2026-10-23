import { request } from './api';

// startsAt/durationMinutes son opcionales: si se omiten, la reserva es
// inmediata ("llego ahora"), igual que antes de agregar reservas programadas.
export async function createReservation({ spaceId, vehiclePlate, startsAt, durationMinutes }) {
    return (await request('/api/reservations', {
        method: 'POST',
        body: {
            spaceId,
            vehiclePlate,
            ...(startsAt ? { startsAt } : {}),
            ...(durationMinutes ? { durationMinutes } : {})
        }
    })).data;
}

export async function listReservations() {
    const { data, meta } = await request('/api/reservations');
    return { reservations: data, total: meta?.total ?? data.length };
}

export async function getReservation(id) {
    return (await request(`/api/reservations/${id}`)).data;
}

export async function cancelReservation(id) {
    return (await request(`/api/reservations/${id}/cancel`, { method: 'PATCH' })).data;
}

// El parámetro de la ruta de entrada es el reservationId, la respuesta incluye sessionId.
export async function registerEntry(reservationId) {
    return (await request(`/api/reservations/sessions/${reservationId}/entry`, { method: 'POST' })).data;
}

export async function registerExit(sessionId) {
    return (await request(`/api/reservations/sessions/${sessionId}/exit`, { method: 'POST' })).data;
}

export async function getSession(sessionId) {
    return (await request(`/api/reservations/sessions/${sessionId}`)).data;
}

// Permite encontrar una sesión por placa o ticket sin conocer su identificador interno.
export async function listSessions({ status, vehiclePlate, ticketNumber } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (vehiclePlate) params.set('vehiclePlate', vehiclePlate);
    if (ticketNumber) params.set('ticketNumber', ticketNumber);
    const query = params.toString();
    const { data, meta } = await request(`/api/reservations/sessions${query ? `?${query}` : ''}`);
    return { sessions: data, total: meta?.total ?? data.length };
}
