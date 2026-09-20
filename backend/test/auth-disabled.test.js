// Auth must fail CLOSED. With no JWT_SECRET the app has to refuse to issue
// sessions rather than sign them with an undefined secret - while leaving the
// shortener itself working for guests.
//
// This lives in its own file because the environment differs, and Node gives
// each test file its own process.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('auth not configured', () => {
    let h;

    before(async () => {
        h = await startHarness({ JWT_SECRET: undefined, ADMIN_KEY: 'break-glass' });
    });

    after(async () => { await h.stop(); });

    test('every auth endpoint returns 503, not a signed token', async () => {
        const s = h.session();
        assert.equal((await s.register('a@b.com')).status, 503);
        assert.equal((await s.login('a@b.com')).status, 503);
        assert.equal((await s.get('/api/auth/me')).status, 503);
    });

    test('the shortener keeps working for guests', async () => {
        assert.equal((await h.session().shorten('https://example.com/still-works')).status, 201);
        assert.equal((await h.session().get('/health')).status, 200);
    });

    // x-admin-key is deliberate break-glass: it works from curl and survives a
    // JWT_SECRET rotation or a locked-out admin account.
    test('the admin key still opens admin routes', async () => {
        const s = h.session();
        assert.equal((await s.get('/api/admin/urls')).status, 401, 'no credentials');
        assert.equal(
            (await s.get('/api/admin/urls', { headers: { 'x-admin-key': 'wrong' } })).status,
            401,
            'wrong key'
        );
        assert.equal(
            (await s.get('/api/admin/urls', { headers: { 'x-admin-key': 'break-glass' } })).status,
            200,
            'correct key works even with auth disabled'
        );
    });

    test('with neither mechanism configured, admin is closed rather than open', async () => {
        delete process.env.ADMIN_KEY;
        assert.equal((await h.session().get('/api/admin/urls')).status, 503);
        process.env.ADMIN_KEY = 'break-glass';
    });
});
