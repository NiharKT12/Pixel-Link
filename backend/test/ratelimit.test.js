// Rate limits are the only thing standing between the free-tier database and a
// script. Their maxima are env-tunable, so this file boots with deliberately
// low values and checks the limiter actually fires.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('rate limiting', () => {
    let h;

    before(async () => {
        h = await startHarness({
            RATE_LIMIT_AUTH_MAX: '3',
            RATE_LIMIT_REGISTER_MAX: '2',
            RATE_LIMIT_SHORTEN_MAX: '4'
        });
    });

    after(async () => { await h.stop(); });

    test('failed logins are capped', async () => {
        const s = h.session();
        const codes = [];
        for (let i = 0; i < 5; i++) {
            codes.push((await s.login('nobody@example.com', 'wrong' + i)).status);
        }

        assert.deepEqual(codes.slice(0, 3), [401, 401, 401], 'first three are ordinary failures');
        assert.equal(codes[3], 429, 'the fourth is refused');
        assert.equal(codes[4], 429);
    });

    test('registrations are capped', async () => {
        const s = h.session();
        assert.equal((await s.register('one@example.com')).status, 201);
        assert.equal((await s.register('two@example.com')).status, 201);
        assert.equal((await s.register('three@example.com')).status, 429);
    });

    test('shortening is capped', async () => {
        const s = h.session();
        const codes = [];
        for (let i = 0; i < 6; i++) {
            codes.push((await s.shorten('https://example.com/rl-' + i)).status);
        }

        assert.deepEqual(codes.slice(0, 4), [201, 201, 201, 201]);
        assert.equal(codes[4], 429, 'the fifth is refused');
    });

    // If trust proxy is wrong, req.ip resolves to a proxy address and every
    // visitor shares one bucket - which silently disables all of the above.
    test('/debug/ip reports what the limiter keys on', async () => {
        const res = await h.session().get('/debug/ip');
        assert.equal(res.status, 200);
        assert.ok(res.body.ip, 'an ip is reported');
        assert.equal(typeof res.body.trustProxyHops, 'number');
    });
});
