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

function validateCreateReservation(body) {
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

    return {
        spaceId: body.spaceId,
        vehiclePlate: body.vehiclePlate.trim()
    };
}

module.exports = {
    isPlainObject,
    assertUuid,
    validateCreateReservation
};
