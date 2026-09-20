const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('guest link expiry', () => {
    let h;
    let guest;
    let member;

    before(async () => {
        h = await startHarness({ GUEST_LINK_TTL_DAYS: '7' });
        guest = h.session();
        member = h.session();
        await member.register('member@example.com');

        // A link from before accounts existed: no expiresAt field at all
        await h.raw('urls').insertOne({
            originalUrl: 'https://example.com/legacy',
            shortCode: 'legacy1',
            numericId: 500,
            clicks: 3,
            createdAt: new Date('2025-01-01')
        });
    });

    after(async () => { await h.stop(); });

    test('guest links expire, signed-in links do not', async () => {
        const g = await guest.shorten('https://example.com/guest');
        const m = await member.shorten('https://example.com/member');

        assert.ok(g.body.expiresAt, 'guest link carries an expiry');
        assert.equal(m.body.expiresAt, null, 'an owned link does not');

        const doc = await h.models.Url.findOne({ shortCode: g.body.shortCode });
        const days = Math.round((doc.expiresAt - Date.now()) / 86400000);
        assert.equal(days, 7);

        // The field must be ABSENT on owned links, not null - a TTL index
        // ignores missing fields, which is what keeps them alive.
        const raw = await h.raw('urls').findOne({ shortCode: m.body.shortCode });
        assert.ok(raw.expiresAt === undefined || raw.expiresAt === null);
    });

    test('custom names follow the same rule', async () => {
        const g = await guest.shorten('https://example.com/gc', 'guest-custom');
        const m = await member.shorten('https://example.com/mc', 'member-custom');

        assert.ok(g.body.expiresAt);
        assert.equal(m.body.expiresAt, null);
    });

    // The grandfathering guarantee. If this ever fails, every link created
    // before accounts existed is about to be deleted.
    test('pre-existing links are never stamped and keep working', async () => {
        const legacy = await h.raw('urls').findOne({ shortCode: 'legacy1' });
        assert.ok(!('expiresAt' in legacy), 'expiresAt must never be backfilled');
        assert.equal((await guest.get('/legacy1')).status, 302);
    });

    test('the TTL index exists and is shaped correctly', async () => {
        const indexes = await h.raw('urls').indexes();
        const ttl = indexes.find((i) => 'expireAfterSeconds' in i);

        assert.ok(ttl, 'TTL index present');
        assert.equal(ttl.expireAfterSeconds, 0, 'delete at the stamped date');
        assert.deepEqual(ttl.key, { expiresAt: 1 }, 'single-field: a TTL index cannot be compound');
    });

    test('cache TTL is clamped to the link lifetime', async () => {
        const g = await guest.shorten('https://example.com/clamped');
        await guest.get('/' + g.body.shortCode);
        assert.equal(h.cacheTtls.get('url2:' + g.body.shortCode), 3600, 'a 7-day link uses the full hour');

        await h.models.Url.create({
            originalUrl: 'https://example.com/soon',
            shortCode: 'soon123',
            numericId: 900,
            expiresAt: new Date(Date.now() + 30000)
        });
        await guest.get('/soon123');
        assert.ok(h.cacheTtls.get('url2:soon123') <= 30);
    });

    test('re-shortening a guest link renews its lifetime', async () => {
        const g = await guest.shorten('https://example.com/renewable');
        await h.models.Url.updateOne(
            { shortCode: g.body.shortCode },
            { $set: { expiresAt: new Date(Date.now() + 60000) } }
        );

        const again = await guest.shorten('https://example.com/renewable');
        assert.equal(again.body.shortCode, g.body.shortCode);

        const renewed = await h.models.Url.findOne({ shortCode: g.body.shortCode });
        assert.equal(Math.round((renewed.expiresAt - Date.now()) / 86400000), 7);
    });

    test('an expired link 404s before the ~60s sweep reaches it', async () => {
        await h.models.Url.create({
            originalUrl: 'https://example.com/dead',
            shortCode: 'dead123',
            numericId: 901,
            expiresAt: new Date(Date.now() - 5000)
        });

        assert.equal((await guest.get('/dead123')).status, 404);
    });

    test('GUEST_LINK_TTL_DAYS=0 is a working kill switch', async () => {
        process.env.GUEST_LINK_TTL_DAYS = '0';
        const off = await guest.shorten('https://example.com/after-kill');
        assert.equal(off.body.expiresAt, null);
        process.env.GUEST_LINK_TTL_DAYS = '7';
    });

    test('/api/config reports the policy the UI describes', async () => {
        const cfg = await guest.get('/api/config');
        assert.equal(cfg.status, 200);
        assert.equal(cfg.body.guestLinkTtlDays, 7);
        assert.equal(cfg.body.accountsEnabled, true);
    });
});
