const { isUuid } = require('./uuid');
const { invalidId, validationError } = require('./errors');

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertUuid(value, field, code = 'INVALID_ID') {
    if (!isUuid(value)) {
        if (code === 'VALIDATION_ERROR') {
            throw validationError([
                { field, message: 'Debe ser un UUID válido.' }
            ]);
        }
        throw invalidId(field);
    }
    return value;
}

// startsAt es opcional: si se omite, la reserva es inmediata ("llego ahora").
// Si se indica, debe estar entre ahora (con un pequeño margen de tolerancia de
// reloj) y el máximo de anticipación configurado.
function parseStartsAt(raw, { now, maxAdvanceMinutes }) {
    if (raw === undefined || raw === null || raw === '') {
        return new Date(now);
    }

    const parsed = new Date(raw);

    if (Number.isNaN(parsed.getTime())) {
        throw validationError([
            { field: 'startsAt', message: 'Debe ser una fecha y hora válidas en formato ISO 8601.' }
        ]);
    }

    const toleranceMs = 60 * 1000;
    const maxMs = now.getTime() + maxAdvanceMinutes * 60 * 1000;

    if (parsed.getTime() < now.getTime() - toleranceMs) {
        throw validationError([
            { field: 'startsAt', message: 'La hora de llegada no puede estar en el pasado.' }
        ]);
    }

    if (parsed.getTime() > maxMs) {
        throw validationError([
            { field: 'startsAt', message: `La hora de llegada no puede anticiparse más de ${maxAdvanceMinutes} minutos.` }
        ]);
    }

    return parsed;
}

// durationMinutes es opcional: representa cuánto tiempo se espera ocupar la
// plaza, usado únicamente para detectar reservas que se superponen en horario.
function parseDurationMinutes(raw, { defaultDurationMinutes, minDurationMinutes, maxDurationMinutes }) {
    if (raw === undefined || raw === null || raw === '') {
        return defaultDurationMinutes;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value < minDurationMinutes || value > maxDurationMinutes) {
        throw validationError([
            {
                field: 'durationMinutes',
                message: `Debe ser un número entero entre ${minDurationMinutes} y ${maxDurationMinutes}.`
            }
        ]);
    }

    return value;
}

function validateCreateReservation(body, scheduling) {
    if (!isPlainObject(body)) {
        throw validationError(null, 'El cuerpo de la solicitud debe ser un objeto JSON.');
    }

    const details = [];
    const hasSpaceId = body.spaceId !== undefined && body.spaceId !== null && String(body.spaceId).trim() !== '';
    const hasVehiclePlate = body.vehiclePlate !== undefined && body.vehiclePlate !== null && String(body.vehiclePlate).trim() !== '';

    if (!hasSpaceId) {
        details.push({ field: 'spaceId', message: 'El identificador de la plaza es obligatorio.' });
    } else if (!isUuid(body.spaceId)) {
        details.push({ field: 'spaceId', message: 'Debe ser un UUID válido.' });
    }

    if (!hasVehiclePlate) {
        details.push({ field: 'vehiclePlate', message: 'La matrícula es obligatoria.' });
    } else if (typeof body.vehiclePlate !== 'string') {
        details.push({ field: 'vehiclePlate', message: 'La matrícula debe ser una cadena de texto.' });
    } else if (body.vehiclePlate.trim().length > 64) {
        details.push({ field: 'vehiclePlate', message: 'La matrícula no puede superar los 64 caracteres.' });
    }

    if (details.length > 0) {
        throw validationError(details);
    }

    const startsAt = parseStartsAt(body.startsAt, scheduling);
    const durationMinutes = parseDurationMinutes(body.durationMinutes, scheduling);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

    return {
        spaceId: body.spaceId,
        vehiclePlate: body.vehiclePlate.trim(),
        startsAt,
        endsAt
    };
}

// Acepta "PAR-000123", "par-123" o "123" y devuelve el número entero interno.
function parseTicketNumber(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }

    const cleaned = String(raw).trim().toUpperCase().replace(/^PAR-?/, '');

    if (!/^\d+$/.test(cleaned)) {
        throw validationError([
            { field: 'ticketNumber', message: 'El número de ticket debe tener el formato PAR-000123.' }
        ]);
    }

    return Number(cleaned);
}

module.exports = {
    isPlainObject,
    assertUuid,
    validateCreateReservation,
    parseTicketNumber
};
