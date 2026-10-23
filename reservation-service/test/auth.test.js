const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createTestContext,
    startServer,
    stopServer,
    request
} = require('./helpers/test-app');

const TOKEN = 'token-de-prueba';

test('protege las rutas internas y deja público el health check', async (t) => {
    const context = createTestContext({ internalApiToken: TOKEN });
    const server = await startServer(context.app);
    t.after(() => stopServer(server));

    const health = await request(server, 'GET', '/health');
    assert.equal(health.status, 200);

    const missing = await request(server, 'GET', '/reservations');
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error.code, 'UNAUTHORIZED');

    const wrong = await request(server, 'GET', '/reservations', {
        headers: { 'x-internal-token': 'incorrecto' }
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'UNAUTHORIZED');

    const allowed = await request(server, 'GET', '/reservations', {
        headers: { 'x-internal-token': TOKEN }
    });
    assert.equal(allowed.status, 200);
});
