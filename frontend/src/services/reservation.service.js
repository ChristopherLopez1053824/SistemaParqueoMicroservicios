import { request } from './api';

export async function createReservation({ spaceId, vehiclePlate }) {
    return (await request('/api/reservations', {
        method: 'POST',
        body: { spaceId, vehiclePlate }
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
