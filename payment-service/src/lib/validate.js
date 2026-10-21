const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function uuidField(body, field, errors) {
    const value = body ? body[field] : undefined;

    if (value === undefined || value === null || value === '') {
        errors.push({ field, message: `El campo ${field} es obligatorio.` });
        return null;
    }

    if (!isUuid(value)) {
        errors.push({ field, message: `El campo ${field} debe ser un UUID v4 válido.` });
        return null;
    }

    return value;
}

module.exports = { isUuid, uuidField };
