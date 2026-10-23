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
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at)
    };
}

function serializeSession(row) {
    return {
        sessionId: row.id,
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
    serializeReservation,
    serializeSession
};
