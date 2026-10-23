const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredTrimmedString(body, field, errors) {
    const value = isPlainObject(body) ? body[field] : undefined;

    if (typeof value !== 'string' || value.trim() === '') {
        errors.push({ field, message: `El campo ${field} es obligatorio.` });
        return null;
    }

    return value.trim();
}

module.exports = { isUuid, isPlainObject, requiredTrimmedString };
