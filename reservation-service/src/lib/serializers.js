function toIso(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeReservation(row) {
    return {
        id: row.id,
        spaceId: row.space_id,
        vehiclePlate: row.vehicle_plate,
        status: row.status,
        startsAt: toIso(row.starts_at),
        endsAt: toIso(row.ends_at),
        // Null mientras la reserva es una franja futura aún no reclamada
        // físicamente en Parking Service (ver registerEntry / ExpirationService).
        spaceClaimedAt: toIso(row.space_claimed_at),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}

// Ticket legible para mostrar al usuario. Es solo de presentación: la identidad
// real de la sesión sigue siendo sessionId (uuid).
function formatTicketNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return `PAR-${String(value).padStart(6, '0')}`;
}

function serializeSession(row) {
    return {
        sessionId: row.id,
        ticketNumber: formatTicketNumber(row.ticket_number),
        reservationId: row.reservation_id,
        spaceId: row.space_id,
        vehiclePlate: row.vehicle_plate,
        status: row.status,
        entryAt: toIso(row.entry_at),
        exitAt: toIso(row.exit_at),
        durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined
            ? null
            : Number(row.duration_seconds)
    };
}

module.exports = {
    toIso,
    formatTicketNumber,
    serializeReservation,
    serializeSession
};
