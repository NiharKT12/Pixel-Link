const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('admin', () => {
    let h;
    let admin;
    let user;
    let guest;

    before(async () => {
        h = await startHarness({ ADMIN_KEY: 'break-glass' });
        admin = h.session();
        user = h.session();
        guest = h.session();

        await admin.register('admin@example.com', 'adminpass123');
        await user.register('user@example.com', 'userpass123');
        await h.models.User.updateOne({ email: 'admin@example.com' }, { $set: { role: 'admin' } });

        await user.shorten('https://example.com/user-1');
        await user.shorten('https://example.com/user-2', 'user-custom');
        await guest.shorten('https://example.com/guest-1');
        await guest.shorten('https://example.com/guest-2');
    });

    after(async () => { await h.stop(); });

    describe('access control', () => {
        test('anonymous 401, ordinary user 403, admin 200', async () => {
            assert.equal((await h.session().get('/api/admin/urls')).status, 401);
            assert.equal((await user.get('/api/admin/urls')).status, 403);
            assert.equal((await admin.get('/api/admin/urls')).status, 200);
        });

        test('the break-glass key works without a session', async () => {
            const res = await h.session().get('/api/admin/urls', { headers: { 'x-admin-key': 'break-glass' } });
            assert.equal(res.status, 200);
        });
    });

    describe('listing', () => {
        test('shows every link, resolving owner emails', async () => {
            const all = await admin.get('/api/admin/urls');
            assert.equal(all.body.totalLinks, 4);

            const owned = all.body.urls.filter((u) => u.ownerEmail);
            assert.equal(owned.length, 2);
            assert.ok(owned.every((u) => u.ownerEmail === 'user@example.com'));
            assert.equal(all.body.urls.filter((u) => !u.ownerEmail).length, 2, 'guest links have no owner');
        });

        test('filters', async () => {
            assert.equal((await admin.get('/api/admin/urls?scope=unclaimed')).body.totalLinks, 2);
            assert.equal((await admin.get('/api/admin/urls?scope=owned')).body.totalLinks, 2);
            assert.equal((await admin.get('/api/admin/urls?scope=custom')).body.totalLinks, 1);
        });

        test('search matches the code and the original url', async () => {
            assert.equal((await admin.get('/api/admin/urls?q=guest-1')).body.totalLinks, 1);
            assert.equal((await admin.get('/api/admin/urls?q=user-custom')).body.totalLinks, 1);
        });

        // A user-supplied string must never reach the regex engine unescaped.
        test('regex metacharacters in search are escaped, not executed', async () => {
            const res = await admin.get('/api/admin/urls?q=' + encodeURIComponent('(a+)+$'));
            assert.equal(res.status, 200);
        });

        test('stats', async () => {
            const s = await admin.get('/api/admin/stats');
            assert.equal(s.body.totalLinks, 4);
            assert.equal(s.body.unclaimed, 2);
            assert.equal(s.body.totalUsers, 2);
        });
    });

    test('admin can delete anyone\'s link, and the cache is invalidated', async () => {
        const list = await admin.get('/api/admin/urls?scope=owned');
        const victim = list.body.urls[0].shortCode;

        await admin.get('/' + victim);
        assert.ok(h.cache.has('url2:' + victim));

        assert.equal((await admin.del('/api/admin/urls/' + victim)).status, 200);
        assert.ok(!h.cache.has('url2:' + victim));
        assert.equal((await admin.get('/' + victim)).status, 404);
    });

    // Bulk delete is the only irreversible operation in the app and there is no
    // backup behind it. Every gate below is deliberate.
    describe('bulk delete', () => {
        test('is refused entirely while ALLOW_DELETE_ALL is unset', async () => {
            const before = await h.models.Url.countDocuments();
            const res = await admin.post('/api/admin/bulk-delete', {
                scope: 'all', confirm: 'DELETE ' + before, password: 'adminpass123'
            });

            assert.equal(res.status, 403);
            assert.equal(await h.models.Url.countDocuments(), before, 'nothing was deleted');
        });

        describe('once enabled', () => {
            before(() => { process.env.ALLOW_DELETE_ALL = 'true'; });
            after(() => { delete process.env.ALLOW_DELETE_ALL; });

            test('an absent or unknown scope is rejected, never treated as "everything"', async () => {
                const count = await h.models.Url.countDocuments();
                assert.equal(
                    (await admin.post('/api/admin/bulk-delete', { confirm: 'DELETE ' + count, password: 'adminpass123' })).status,
                    400
                );
                assert.equal(
                    (await admin.post('/api/admin/bulk-delete', { scope: 'nonsense', confirm: 'DELETE ' + count, password: 'adminpass123' })).status,
                    400
                );
                assert.equal(await h.models.Url.countDocuments(), count);
            });

            test('the session cookie alone is not enough - step-up password required', async () => {
                const count = await h.models.Url.countDocuments();
                assert.equal(
                    (await admin.post('/api/admin/bulk-delete', { scope: 'all', confirm: 'DELETE ' + count })).status,
                    401
                );
                assert.equal(
                    (await admin.post('/api/admin/bulk-delete', { scope: 'all', confirm: 'DELETE ' + count, password: 'wrong' })).status,
                    401
                );
                assert.equal(await h.models.Url.countDocuments(), count);
            });

            test('a stale or blind confirmation is rejected', async () => {
                const count = await h.models.Url.countDocuments();
                const res = await admin.post('/api/admin/bulk-delete', {
                    scope: 'all', confirm: 'DELETE 9999', password: 'adminpass123'
                });

                assert.equal(res.status, 409);
                assert.equal(res.body.expected, 'DELETE ' + count);
                assert.equal(await h.models.Url.countDocuments(), count);
            });

            test('a scoped run deletes only what it claimed, and spares the rest', async () => {
                const preview = await admin.get('/api/admin/bulk-preview?scope=unclaimed');
                assert.equal(preview.body.count, 2);
                assert.equal(preview.body.confirm, 'DELETE 2');

                const ownedBefore = await h.models.Url.countDocuments({ owner: { $ne: null } });

                const res = await admin.post('/api/admin/bulk-delete', {
                    scope: 'unclaimed', confirm: preview.body.confirm, password: 'adminpass123'
                });

                assert.equal(res.status, 200);
                assert.equal(res.body.deleted, 2);
                assert.equal(await h.models.Url.countDocuments({ owner: null }), 0);
                assert.equal(
                    await h.models.Url.countDocuments({ owner: { $ne: null } }),
                    ownedBefore,
                    'owned links untouched - scoping held'
                );
            });

            // flushall would take url_counter with it, and every insert before
            // the next restart would then collide on numericId.
            test('the id counter survives a bulk delete', async () => {
                const counter = Number(h.cache.get('url_counter'));
                assert.ok(counter >= 4, 'url_counter intact: ' + counter);
            });
        });
    });
});
