// Proves MongoDB itself deletes expired links, rather than just asserting the
// index exists. The TTL monitor runs about once a minute, so this takes real
// time and is opt-in:
//
//   RUN_SLOW_TESTS=1 npm test
//
// It lives in its own file because the harness can only be started once per
// process - server.js and mongoose are module-level singletons, so a second
// harness would quietly keep using the first one's database.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

const slow = process.env.RUN_SLOW_TESTS
    ? false
    : 'slow: set RUN_SLOW_TESTS=1 to run';

describe('TTL sweep', { skip: slow }, () => {
    let h;

    before(async () => { h = await startHarness({ GUEST_LINK_TTL_DAYS: '7' }); });
    after(async () => { await h.stop(); });

    test('expired documents are deleted; everything else survives', { timeout: 200000 }, async () => {
        await h.models.Url.create({
            originalUrl: 'https://example.com/expired',
            shortCode: 'expired1',
            numericId: 1,
            expiresAt: new Date(Date.now() - 120000)
        });
        await h.models.Url.create({
            originalUrl: 'https://example.com/future',
            shortCode: 'future01',
            numericId: 2,
            expiresAt: new Date(Date.now() + 7 * 86400000)
        });
        // No expiresAt field at all - the grandfathered case
        await h.raw('urls').insertOne({
            originalUrl: 'https://example.com/legacy',
            shortCode: 'legacy01',
            numericId: 3,
            clicks: 0,
            createdAt: new Date()
        });

        const deadline = Date.now() + 150000;
        while (await h.models.Url.exists({ shortCode: 'expired1' })) {
            if (Date.now() > deadline) {
                assert.fail('the TTL monitor did not remove the expired document within 150s');
            }
            await new Promise((r) => setTimeout(r, 5000));
        }

        assert.ok(await h.models.Url.exists({ shortCode: 'future01' }), 'future-dated link survived');
        assert.ok(await h.models.Url.exists({ shortCode: 'legacy01' }), 'link with no expiresAt survived');

        const legacy = await h.raw('urls').findOne({ shortCode: 'legacy01' });
        assert.ok(!('expiresAt' in legacy), 'and it was never stamped');
    });
});
