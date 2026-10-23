const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const pool = require('../src/db');
const app = require('../src/server');

const SPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const MISSING_ID = '550e8400-e29b-41d4-a716-446655440099';
const CREATED_AT = new Date('2026-10-19T18:30:00.000Z');
const UPDATED_AT = new Date('2026-10-20T09:15:00.000Z');

let server;
let baseUrl;
let originalQuery;

function spaceRow(overrides = {}) {
    return {
        id: SPACE_ID,
        code: 'A-01',
        level: 'Nivel 1',
        space_type: 'standard',
        status: 'available',
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
        ...overrides
    };
}

async function request(path, options) {
    const response = await fetch(`${baseUrl}${path}`, options);
    const text = await response.text();
    let body = null;

    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }

    return { status: response.status, headers: response.headers, body };
}

function jsonOptions(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

before(async () => {
    console.error = () => {};
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

beforeEach(() => {
    originalQuery = pool.query;
});

afterEach(() => {
    pool.query = originalQuery;
});

test('GET /spaces devuelve data y meta.total con campos camelCase', async () => {
    pool.query = async () => ({ rowCount: 1, rows: [spaceRow()] });

    const { status, headers, body } = await request('/spaces');

    assert.equal(status, 200);
    assert.deepEqual(body, {
        data: [{
            id: SPACE_ID,
            code: 'A-01',
            level: 'Nivel 1',
            spaceType: 'standard',
            status: 'available',
            createdAt: '2026-10-19T18:30:00.000Z',
            updatedAt: '2026-10-19T18:30:00.000Z'
        }],
        meta: { total: 1 }
    });
    assert.match(headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
    assert.equal('space_type' in body.data[0], false);
    assert.equal('created_at' in body.data[0], false);
});

test('GET /spaces/:id devuelve una plaza existente', async () => {
    pool.query = async (text, params) => {
        assert.match(text, /WHERE id = \$1/);
        assert.deepEqual(params, [SPACE_ID]);
        return { rowCount: 1, rows: [spaceRow()] };
    };

    const { status, body } = await request(`/spaces/${SPACE_ID}`);

    assert.equal(status, 200);
    assert.equal(body.data.id, SPACE_ID);
    assert.equal(body.data.spaceType, 'standard');
});

test('GET /spaces/:id rechaza UUID inválido sin consultar la base de datos', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request('/spaces/not-a-uuid');

    assert.equal(status, 400);
    assert.equal(body.error.code, 'INVALID_ID');
    assert.equal(body.error.details, null);
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/i);
});

test('GET /spaces/:id devuelve 404 cuando la plaza no existe', async () => {
    pool.query = async () => ({ rowCount: 0, rows: [] });

    const { status, body } = await request(`/spaces/${MISSING_ID}`);

    assert.equal(status, 404);
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
});

test('POST /spaces registra una plaza con id y estado generados por el servidor', async () => {
    const providedId = '550e8400-e29b-41d4-a716-446655440123';
    let insertParams;

    pool.query = async (text, params) => {
        assert.match(text, /INSERT INTO parking\.parking_spaces/);
        insertParams = params;
        return {
            rowCount: 1,
            rows: [spaceRow({ code: 'A-09', level: 'Nivel 3', space_type: 'electric' })]
        };
    };

    const { status, body } = await request('/spaces', jsonOptions('POST', {
        id: providedId,
        status: 'occupied',
        code: 'A-09',
        level: 'Nivel 3',
        spaceType: 'electric'
    }));

    assert.equal(status, 201);
    assert.deepEqual(insertParams, ['A-09', 'Nivel 3', 'electric']);
    assert.equal(body.data.id, SPACE_ID);
    assert.notEqual(body.data.id, providedId);
    assert.equal(body.data.status, 'available');
    assert.equal(body.data.spaceType, 'electric');
});

test('POST /spaces usa standard cuando spaceType se omite', async () => {
    pool.query = async (text, params) => {
        assert.deepEqual(params, ['B-10', 'Nivel 2', 'standard']);
        return { rowCount: 1, rows: [spaceRow({ code: 'B-10', level: 'Nivel 2' })] };
    };

    const { status, body } = await request('/spaces', jsonOptions('POST', {
        code: 'B-10',
        level: 'Nivel 2'
    }));

    assert.equal(status, 201);
    assert.equal(body.data.spaceType, 'standard');
});

test('POST /spaces rechaza campos obligatorios ausentes', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request('/spaces', jsonOptions('POST', {}));

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(
        body.error.details.map((detail) => detail.field).sort(),
        ['code', 'level']
    );
});

test('POST /spaces rechaza un spaceType inválido', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request('/spaces', jsonOptions('POST', {
        code: 'A-10',
        level: 'Nivel 1',
        spaceType: 'vip'
    }));

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].field, 'spaceType');
});

test('POST /spaces devuelve 409 cuando el código ya existe', async () => {
    const duplicate = new Error('duplicate key value violates unique constraint "parking_spaces_code_key"');
    duplicate.code = '23505';
    duplicate.constraint = 'parking_spaces_code_key';

    pool.query = async () => {
        throw duplicate;
    };

    const { status, body } = await request('/spaces', jsonOptions('POST', {
        code: 'A-01',
        level: 'Nivel 1',
        spaceType: 'standard'
    }));

    assert.equal(status, 409);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].field, 'code');
    assert.doesNotMatch(JSON.stringify(body), /duplicate key|23505|parking_spaces_code_key/);
});

test('PATCH /spaces/:id/status actualiza a un estado permitido y updatedAt', async () => {
    pool.query = async (text, params) => {
        assert.match(text, /UPDATE parking\.parking_spaces/);
        assert.equal(params[0], SPACE_ID);
        assert.equal(params[1], 'maintenance');
        assert.deepEqual(params[2], ['available']);
        return {
            rowCount: 1,
            rows: [spaceRow({ status: 'maintenance', updated_at: UPDATED_AT })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'maintenance' })
    );

    assert.equal(status, 200);
    assert.equal(body.data.status, 'maintenance');
    assert.equal(body.data.updatedAt, '2026-10-20T09:15:00.000Z');
});

test('PATCH /spaces/:id/status rechaza estados desconocidos', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'broken' })
    );

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].field, 'status');
});

test('PATCH /spaces/:id/status rechaza "occupied" sin consultar la base de datos', async () => {
    // "occupied" y "reserved" solo pueden asignarse a través de los endpoints de
    // reserva, que validan el reservationId propietario. El endpoint genérico no
    // debe poder ocupar ni liberar una plaza sin pasar por ese flujo.
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'occupied' })
    );

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].field, 'status');
});

test('PATCH /spaces/:id/status rechaza "reserved" sin consultar la base de datos', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'reserved' })
    );

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].field, 'status');
});

test('PATCH /spaces/:id/status no puede liberar una plaza ocupada sin pasar por checkout', async () => {
    // Antes de la corrección, esta llamada liberaba directamente una plaza
    // "occupied" a "available" sin verificar ninguna reserva ni sesión activa.
    // "available" sigue siendo un estado administrable (regresa de mantenimiento),
    // pero su único origen admitido por este endpoint es "maintenance", no "occupied".
    pool.query = async (text) => {
        if (text.includes('UPDATE parking.parking_spaces')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('WHERE id = $1')) {
            return { rowCount: 1, rows: [spaceRow({ status: 'occupied' })] };
        }
        throw new Error(`Consulta inesperada: ${text}`);
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'available' })
    );

    assert.equal(status, 409);
    assert.equal(body.error.code, 'INVALID_STATE_TRANSITION');
});

test('PATCH /spaces/:id/status rechaza transiciones incompatibles', async () => {
    pool.query = async (text) => {
        if (text.includes('UPDATE parking.parking_spaces')) {
            return { rowCount: 0, rows: [] };
        }
        if (text.includes('WHERE id = $1')) {
            return { rowCount: 1, rows: [spaceRow({ status: 'available' })] };
        }
        throw new Error(`Consulta inesperada: ${text}`);
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/status`,
        jsonOptions('PATCH', { status: 'available' })
    );

    assert.equal(status, 409);
    assert.equal(body.error.code, 'INVALID_STATE_TRANSITION');
});

test('PATCH /spaces/:id/status devuelve 404 si la plaza no existe', async () => {
    pool.query = async (text) => {
        if (text.includes('UPDATE parking.parking_spaces')) {
            return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    };

    const { status, body } = await request(
        `/spaces/${MISSING_ID}/status`,
        jsonOptions('PATCH', { status: 'available' })
    );

    assert.equal(status, 404);
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
});

test('los errores de base de datos no filtran información sensible', async () => {
    const databaseError = new Error(
        'password=super-secret host=db.internal.example connection refused'
    );
    databaseError.code = '28P01';

    pool.query = async () => {
        throw databaseError;
    };

    const { status, body } = await request('/spaces');
    const serialized = JSON.stringify(body);

    assert.equal(status, 500);
    assert.equal(body.error.code, 'DATABASE_ERROR');
    assert.equal(body.error.details, null);
    assert.doesNotMatch(serialized, /super-secret|db\.internal|password|28P01/);
});

test('los errores de conexión devuelven SERVICE_UNAVAILABLE', async () => {
    const connectionError = new Error('connect ECONNREFUSED 10.0.0.1:5432');
    connectionError.code = 'ECONNREFUSED';

    pool.query = async () => {
        throw connectionError;
    };

    const { status, body } = await request('/spaces');

    assert.equal(status, 503);
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /ECONNREFUSED|10\.0\.0\.1/);
});

test('un JSON mal formado devuelve VALIDATION_ERROR', async () => {
    const { status, body } = await request('/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"code":'
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
});

const RESERVATION_ID = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_RESERVATION_ID = '770e8400-e29b-41d4-a716-446655440000';

test('GET /spaces/:id incluye reservedByReservationId', async () => {
    pool.query = async () => ({
        rowCount: 1,
        rows: [spaceRow({
            status: 'reserved',
            reserved_by_reservation_id: RESERVATION_ID
        })]
    });

    const { status, body } = await request(`/spaces/${SPACE_ID}`);

    assert.equal(status, 200);
    assert.equal(body.data.reservedByReservationId, RESERVATION_ID);
});

test('POST /spaces/:id/reserve reserva una plaza disponible para la reserva', async () => {
    let updateParams;

    pool.query = async (text, params) => {
        assert.match(text, /SET status = 'reserved', reserved_by_reservation_id = \$2/);
        updateParams = params;
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'reserved',
                reserved_by_reservation_id: RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/reserve`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.deepEqual(updateParams, [SPACE_ID, RESERVATION_ID]);
    assert.equal(body.data.status, 'reserved');
    assert.equal(body.data.reservedByReservationId, RESERVATION_ID);
});

test('POST /spaces/:id/reserve es idempotente para la misma reserva', async () => {
    pool.query = async (text) => {
        if (text.includes("SET status = 'reserved'")) {
            return { rowCount: 0, rows: [] };
        }
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'reserved',
                reserved_by_reservation_id: RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/reserve`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.equal(body.data.reservedByReservationId, RESERVATION_ID);
});

test('POST /spaces/:id/reserve rechaza una plaza de otra reserva', async () => {
    pool.query = async (text) => {
        if (text.includes("SET status = 'reserved'")) {
            return { rowCount: 0, rows: [] };
        }
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'reserved',
                reserved_by_reservation_id: OTHER_RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/reserve`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 409);
    assert.equal(body.error.code, 'RESERVATION_CONFLICT');
});

test('POST /spaces/:id/reserve rechaza una plaza no disponible', async () => {
    pool.query = async (text) => {
        if (text.includes("SET status = 'reserved'")) {
            return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [spaceRow({ status: 'occupied' })] };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/reserve`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 409);
    assert.equal(body.error.code, 'SPACE_NOT_AVAILABLE');
});

test('POST /spaces/:id/reserve exige un reservationId UUID', async () => {
    pool.query = async () => {
        throw new Error('No debe consultarse la base de datos');
    };

    const missing = await request(`/spaces/${SPACE_ID}/reserve`, jsonOptions('POST', {}));
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'VALIDATION_ERROR');
    assert.equal(missing.body.error.details[0].field, 'reservationId');

    const invalid = await request(
        `/spaces/${SPACE_ID}/reserve`,
        jsonOptions('POST', { reservationId: 'no-es-uuid' })
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

test('POST /spaces/:id/reserve devuelve 404 si la plaza no existe', async () => {
    pool.query = async () => ({ rowCount: 0, rows: [] });

    const { status, body } = await request(
        `/spaces/${MISSING_ID}/reserve`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 404);
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
});

test('POST /spaces/:id/occupy ocupa una plaza reservada por la misma reserva', async () => {
    pool.query = async (text, params) => {
        assert.match(text, /SET status = 'occupied'/);
        assert.match(text, /reserved_by_reservation_id = \$2/);
        assert.deepEqual(params, [SPACE_ID, RESERVATION_ID]);
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'occupied',
                reserved_by_reservation_id: RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/occupy`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.equal(body.data.status, 'occupied');
});

test('POST /spaces/:id/occupy es idempotente si ya está ocupada por la reserva', async () => {
    pool.query = async (text) => {
        if (text.includes("SET status = 'occupied'")) {
            return { rowCount: 0, rows: [] };
        }
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'occupied',
                reserved_by_reservation_id: RESERVATION_ID
            })]
        };
    };

    const { status } = await request(
        `/spaces/${SPACE_ID}/occupy`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
});

test('POST /spaces/:id/occupy rechaza una plaza reservada por otra reserva', async () => {
    pool.query = async (text) => {
        if (text.includes("SET status = 'occupied'")) {
            return { rowCount: 0, rows: [] };
        }
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'reserved',
                reserved_by_reservation_id: OTHER_RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/occupy`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 409);
    assert.equal(body.error.code, 'RESERVATION_CONFLICT');
});

test('POST /spaces/:id/release libera una plaza reservada y limpia el dueño', async () => {
    pool.query = async (text, params) => {
        assert.match(text, /SET status = 'available', reserved_by_reservation_id = NULL/);
        assert.deepEqual(params, [SPACE_ID, RESERVATION_ID]);
        return {
            rowCount: 1,
            rows: [spaceRow({ status: 'available', reserved_by_reservation_id: null })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/release`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.equal(body.data.status, 'available');
    assert.equal(body.data.reservedByReservationId, null);
});

test('POST /spaces/:id/checkout libera una plaza ocupada', async () => {
    pool.query = async (text) => {
        assert.match(text, /SET status = 'available', reserved_by_reservation_id = NULL/);
        assert.match(text, /status = 'occupied'/);
        return { rowCount: 1, rows: [spaceRow({ status: 'available' })] };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/checkout`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.equal(body.data.status, 'available');
});

test('POST /spaces/:id/restore devuelve una plaza ocupada a reservada', async () => {
    pool.query = async (text) => {
        assert.match(text, /SET status = 'reserved'/);
        assert.match(text, /status = 'occupied'/);
        return {
            rowCount: 1,
            rows: [spaceRow({
                status: 'reserved',
                reserved_by_reservation_id: RESERVATION_ID
            })]
        };
    };

    const { status, body } = await request(
        `/spaces/${SPACE_ID}/restore`,
        jsonOptions('POST', { reservationId: RESERVATION_ID })
    );

    assert.equal(status, 200);
    assert.equal(body.data.status, 'reserved');
    assert.equal(body.data.reservedByReservationId, RESERVATION_ID);
});
