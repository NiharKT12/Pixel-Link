const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('link ownership', () => {
    let h;
    let alice;
    let bob;
    let guest;
    let aliceId;

    before(async () => {
        h = await startHarness();
        alice = h.session();
        bob = h.session();
        guest = h.session();

        await alice.register('alice@example.com');
        await bob.register('bob@example.com');
        aliceId = String((await h.models.User.findOne({ email: 'alice@example.com' }))._id);
    });

    after(async () => { await h.stop(); });

    test('a signed-in link is owned, a guest link is not', async () => {
        const owned = await alice.shorten('https://example.com/alice-1');
        const anon = await guest.shorten('https://example.com/guest-1');

        const ownedDoc = await h.models.Url.findOne({ shortCode: owned.body.shortCode });
        const anonDoc = await h.models.Url.findOne({ shortCode: anon.body.shortCode });

        assert.equal(String(ownedDoc.owner), aliceId);
        assert.equal(anonDoc.owner, null);
    });

    // Without owner scoping, a signed-in user shortening a URL a guest had
    // already shortened would be handed the guest's link - which then expires
    // out from under them.
    test('dedupe is scoped to the owner', async () => {
        const fromGuest = await guest.shorten('https://example.com/shared');
        const fromAlice = await alice.shorten('https://example.com/shared');

        assert.notEqual(
            fromAlice.body.shortCode,
            fromGuest.body.shortCode,
            'a signed-in user must not inherit a guest link'
        );

        const doc = await h.models.Url.findOne({ shortCode: fromAlice.body.shortCode });
        assert.equal(String(doc.owner), aliceId);

        // ...but dedupe still applies within one owner
        const again = await alice.shorten('https://example.com/shared');
        assert.equal(again.body.shortCode, fromAlice.body.shortCode);

        const guestAgain = await guest.shorten('https://example.com/shared');
        assert.equal(guestAgain.body.shortCode, fromGuest.body.shortCode);
    });

    describe('GET /api/me/urls', () => {
        test('requires a session', async () => {
            assert.equal((await h.session().get('/api/me/urls')).status, 401);
        });

        test('returns only the caller\'s links', async () => {
            const list = await alice.get('/api/me/urls');
            assert.equal(list.status, 200);

            const codes = list.body.urls.map((u) => u.shortCode);
            const guestLink = await h.models.Url.findOne({ originalUrl: 'https://example.com/guest-1' });

            assert.ok(codes.length > 0);
            assert.ok(!codes.includes(guestLink.shortCode), 'other people\'s links are invisible');
            assert.equal(list.body.totalLinks, codes.length);

            const empty = await bob.get('/api/me/urls');
            assert.equal(empty.body.totalLinks, 0, 'Bob created nothing');
        });

        test('totals are scoped to the owner, not global', async () => {
            const mine = await h.models.Url.findOne({ owner: { $ne: null }, originalUrl: 'https://example.com/alice-1' });
            const theirs = await h.models.Url.findOne({ originalUrl: 'https://example.com/guest-1' });

            await h.models.Url.updateOne({ _id: mine._id }, { $set: { clicks: 7 } });
            await h.models.Url.updateOne({ _id: theirs._id }, { $set: { clicks: 99 } });

            const list = await alice.get('/api/me/urls');
            assert.equal(list.body.totalClicks, 7, 'the guest link\'s 99 clicks must not be counted');
        });
    });

    describe('DELETE /api/me/urls/:code', () => {
        test('another user gets 404, which does not confirm the link exists', async () => {
            const mine = await alice.shorten('https://example.com/not-yours');
            const code = mine.body.shortCode;

            assert.equal((await bob.del('/api/me/urls/' + code)).status, 404);
            assert.equal((await h.session().del('/api/me/urls/' + code)).status, 401, 'anonymous');
            assert.ok(await h.models.Url.exists({ shortCode: code }), 'and the link survives');
        });

        // The regression most likely to reappear: a deleted link kept
        // redirecting from cache for up to an hour.
        test('deleting invalidates the cache immediately', async () => {
            const made = await alice.shorten('https://example.com/to-delete');
            const code = made.body.shortCode;

            assert.equal((await alice.get('/' + code)).status, 302);
            assert.ok(h.cache.has('url2:' + code), 'cached by the redirect');

            assert.equal((await alice.del('/api/me/urls/' + code)).status, 200);

            assert.ok(!h.cache.has('url2:' + code), 'cache entry removed');
            assert.equal((await alice.get('/' + code)).status, 404, '404s at once, not in an hour');
            assert.equal(await h.models.Url.exists({ shortCode: code }), null);
        });

        test('deleting twice, or a malformed code, is a clean 404', async () => {
            const made = await alice.shorten('https://example.com/twice');
            const code = made.body.shortCode;

            assert.equal((await alice.del('/api/me/urls/' + code)).status, 200);
            assert.equal((await alice.del('/api/me/urls/' + code)).status, 404);
            assert.equal((await alice.del('/api/me/urls/not!valid')).status, 404);
        });
    });
});
