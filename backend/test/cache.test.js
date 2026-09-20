const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('link cache', () => {
    let h;
    let guest;

    before(async () => {
        h = await startHarness();
        guest = h.session();
    });

    after(async () => { await h.stop(); });

    test('shortening and redirecting still work end to end', async () => {
        const made = await guest.shorten('https://example.com/normal');
        assert.equal(made.status, 201);

        const miss = await guest.get('/' + made.body.shortCode);
        assert.equal(miss.status, 302, 'cache-miss path redirects');
        assert.equal(miss.location, 'https://example.com/normal');

        const hit = await guest.get('/' + made.body.shortCode);
        assert.equal(hit.location, 'https://example.com/normal', 'cache-hit path redirects');
    });

    test('cache entries use the url2: prefix and carry the expiry', async () => {
        const made = await guest.shorten('https://example.com/prefixed');
        await guest.get('/' + made.body.shortCode);

        const key = 'url2:' + made.body.shortCode;
        assert.ok(h.cache.has(key), 'key written under url2:');
        assert.ok(!h.cache.has('url:' + made.body.shortCode), 'legacy url: prefix is not written');

        const entry = JSON.parse(h.cache.get(key));
        assert.equal(entry.u, 'https://example.com/prefixed');
        assert.equal(entry.e, null, 'no expiry on a link that does not expire');
    });

    // The regression this whole module exists for: a popular link refreshes its
    // own cache TTL on every hit, so without clamping it would outlive the link.
    test('cache TTL is clamped to the remaining life of the link', async () => {
        await h.models.Url.create({
            originalUrl: 'https://example.com/soon',
            shortCode: 'soonish',
            numericId: 90001,
            expiresAt: new Date(Date.now() + 30000)
        });

        await guest.get('/soonish');
        const ttl = h.cacheTtls.get('url2:soonish');
        assert.ok(ttl <= 30, `expected <= 30s, got ${ttl}s`);
    });

    test('effectiveTtl: no expiry uses the full window, past expiry caches nothing', () => {
        const cache = require('../lib/cache');
        assert.equal(cache.effectiveTtl(null), 3600);
        assert.equal(cache.effectiveTtl(new Date(Date.now() - 1000)), 0);
        assert.ok(cache.effectiveTtl(new Date(Date.now() + 10000)) <= 10);
    });

    // MongoDB fires no hook when a TTL index deletes a document, so the cache
    // has to notice on its own.
    test('an expired entry evicts itself and falls through to MongoDB', async () => {
        const past = new Date(Date.now() - 60000);
        await h.models.Url.create({
            originalUrl: 'https://example.com/zombie',
            shortCode: 'zombie',
            numericId: 90003,
            expiresAt: past
        });
        h.cache.set('url2:zombie', JSON.stringify({ u: 'https://example.com/zombie', e: Date.now() - 5000 }));

        const res = await guest.get('/zombie');
        assert.equal(res.status, 404, 'expired link is not served from cache');
        assert.ok(!h.cache.has('url2:zombie'), 'stale entry was evicted');
    });

    test('an expired document is hidden before the TTL sweep reaches it', async () => {
        await h.models.Url.create({
            originalUrl: 'https://example.com/dead',
            shortCode: 'deadlnk',
            numericId: 90002,
            expiresAt: new Date(Date.now() - 60000)
        });

        const res = await guest.get('/deadlnk');
        assert.equal(res.status, 404);
        assert.ok(!h.cache.has('url2:deadlnk'), 'and it was never cached');
    });

    // The grandfathering guarantee: links created before expiry existed have no
    // expiresAt field at all, and a TTL index ignores those.
    test('a document with no expiresAt field still redirects and is never stamped', async () => {
        await h.raw('urls').insertOne({
            originalUrl: 'https://example.com/legacy',
            shortCode: 'legacy1',
            numericId: 90004,
            clicks: 0,
            createdAt: new Date()
        });

        const res = await guest.get('/legacy1');
        assert.equal(res.status, 302);
        assert.equal(res.location, 'https://example.com/legacy');

        const doc = await h.raw('urls').findOne({ shortCode: 'legacy1' });
        assert.ok(!('expiresAt' in doc), 'expiresAt must never be backfilled');
    });

    test('junk paths are rejected without a database round trip', async () => {
        assert.equal((await guest.get('/favicon.ico')).status, 404);
        assert.equal((await guest.get('/not a code!')).status, 404);
    });

    test('indexes: owner listing index exists, any TTL index is single-field', async () => {
        const indexes = await h.raw('urls').indexes();
        assert.ok(
            indexes.some((i) => JSON.stringify(i.key) === '{"owner":1,"createdAt":-1}'),
            'owner + createdAt index backs the dashboard listing'
        );
        for (const i of indexes.filter((x) => 'expireAfterSeconds' in x)) {
            assert.equal(Object.keys(i.key).length, 1, 'a TTL index cannot be compound');
        }
    });
});

// Redis being deleted by the provider is a thing that actually happened to this
// project, so the cache API must stay callable with no Redis at all.
describe('cache with Redis disabled', () => {
    test('every operation degrades instead of throwing', async () => {
        const saved = process.env.REDIS_URL;
        delete process.env.REDIS_URL;
        // Fresh module registry so config/redis.js re-evaluates REDIS_URL
        for (const k of Object.keys(require.cache)) {
            if (k.includes('config') && k.includes('redis')) delete require.cache[k];
            if (k.includes('lib') && k.includes('cache')) delete require.cache[k];
        }

        const cache = require('../lib/cache');
        await cache.delLink('abc');
        await cache.delLinks(['a', 'b', 'c']);
        assert.equal(await cache.getLink('abc'), null, 'reads are a permanent miss');
        await cache.setLink('abc', 'https://example.com', null);

        if (saved) process.env.REDIS_URL = saved;
    });
});
