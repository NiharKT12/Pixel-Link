const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

describe('accounts and sessions', () => {
    let h;
    let alice;

    before(async () => {
        h = await startHarness();
        alice = h.session();
    });

    after(async () => { await h.stop(); });

    describe('registration', () => {
        test('rejects a malformed email and a short password', async () => {
            assert.equal((await alice.register('nope')).status, 400);
            assert.equal((await alice.register('a@b.com', 'short')).status, 400);
        });

        test('normalises the email and never returns the password hash', async () => {
            // Trailing whitespace is normal when an address is pasted
            const res = await alice.register('  Alice@Example.com  ');
            assert.equal(res.status, 201);
            assert.equal(res.body.user.email, 'alice@example.com');
            assert.equal(res.body.user.role, 'user');
            assert.ok(!('passwordHash' in res.body.user));
        });

        test('sets a hardened session cookie', async () => {
            const cookie = (await h.session().register('cookie@example.com')).setCookie[0];
            assert.match(cookie, /pl_session=/);
            assert.match(cookie, /HttpOnly/i, 'not readable by injected script');
            assert.match(cookie, /SameSite=Lax/i);
            assert.ok(!/Domain=/i.test(cookie), 'host-only: vercel.app is on the Public Suffix List');
        });

        test('a duplicate email is refused', async () => {
            assert.equal((await h.session().register('alice@example.com')).status, 409);
        });
    });

    describe('login', () => {
        test('a valid session identifies the user', async () => {
            const me = await alice.get('/api/auth/me');
            assert.equal(me.status, 200);
            assert.equal(me.body.user.email, 'alice@example.com');
        });

        // The endpoint must not become a way to discover who has an account.
        test('wrong password and unknown account are indistinguishable', async () => {
            const s = h.session();
            const wrongPassword = await s.login('alice@example.com', 'wrongpassword');
            const noSuchUser = await s.login('ghost@example.com', 'wrongpassword');

            assert.equal(wrongPassword.status, noSuchUser.status);
            assert.deepEqual(wrongPassword.body, noSuchUser.body);
            assert.equal(wrongPassword.status, 401);
        });

        test('the correct password signs in', async () => {
            const s = h.session();
            assert.equal((await s.login('alice@example.com')).status, 200);
            assert.equal((await s.get('/api/auth/me')).status, 200);
        });

        test('logging out invalidates the session', async () => {
            const s = h.session();
            await s.login('alice@example.com');
            await s.post('/api/auth/logout', {});
            assert.equal((await s.get('/api/auth/me')).status, 401);
        });
    });

    describe('token integrity', () => {
        test('garbage and tampered tokens are rejected', async () => {
            const s = h.session();
            await s.login('alice@example.com');
            const good = (await s.get('/api/auth/me')).status;
            assert.equal(good, 200);

            const garbage = await h.session().get('/api/auth/me', { headers: { Cookie: 'pl_session=not.a.jwt' } });
            assert.equal(garbage.status, 401);

            const login = await h.session().login('alice@example.com');
            const token = login.setCookie[0].split(';')[0];
            const tampered = token.slice(0, -3) + 'AAA';
            assert.equal((await h.session().get('/api/auth/me', { headers: { Cookie: tampered } })).status, 401);
        });

        test('bumping tokenVersion revokes existing sessions', async () => {
            const s = h.session();
            await s.login('alice@example.com');
            assert.equal((await s.get('/api/auth/me')).status, 200);

            await h.models.User.updateOne({ email: 'alice@example.com' }, { $inc: { tokenVersion: 1 } });
            assert.equal((await s.get('/api/auth/me')).status, 401);
        });
    });

    // The in-memory rate limiter resets whenever the free-tier instance spins
    // down, so the durable half on the user document is what actually protects
    // the account. It is driven directly here so the IP limiter does not fire
    // first and mask it.
    describe('account lockout', () => {
        test('locks after repeated failures and persists the lock', async () => {
            await h.models.User.updateOne(
                { email: 'alice@example.com' },
                { $set: { failedLogins: 9, lockedUntil: null } }
            );

            const tripping = await h.session().login('alice@example.com', 'wrong-one');
            assert.equal(tripping.status, 401, 'still the generic error');

            const locked = await h.models.User.findOne({ email: 'alice@example.com' });
            assert.ok(locked.lockedUntil > new Date(), 'lock survives a restart');
            assert.equal(locked.failedLogins, 0);

            const refused = await h.session().login('alice@example.com');
            assert.equal(refused.status, 429, 'the correct password is refused while locked');
        });

        test('a successful login clears the counter once the lock expires', async () => {
            await h.models.User.updateOne(
                { email: 'alice@example.com' },
                { $set: { lockedUntil: null, failedLogins: 3 } }
            );

            assert.equal((await h.session().login('alice@example.com')).status, 200);
            const after = await h.models.User.findOne({ email: 'alice@example.com' });
            assert.equal(after.failedLogins, 0);
        });
    });

    describe('admin role', () => {
        test('role is read from the database, so demotion is immediate', async () => {
            const boss = h.session();
            const created = await boss.register('boss@example.com');
            assert.equal(created.body.user.role, 'user', 'nobody is admin just by registering');
            assert.equal((await boss.get('/api/admin/urls')).status, 403);

            await h.models.User.updateOne({ email: 'boss@example.com' }, { $set: { role: 'admin' } });
            assert.equal((await boss.get('/api/admin/urls')).status, 200);

            await h.models.User.updateOne({ email: 'boss@example.com' }, { $set: { role: 'user' } });
            assert.equal(
                (await boss.get('/api/admin/urls')).status,
                403,
                'the token was not re-issued, so the role cannot be cached in it'
            );
        });
    });

    test('guests can still shorten links', async () => {
        assert.equal((await h.session().shorten('https://example.com/guest')).status, 201);
    });
});
