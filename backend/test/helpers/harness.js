// Boots the real server.js against an in-memory MongoDB and an in-process
// Redis, so tests exercise the actual app rather than a stand-in.
//
// Node's test runner gives each test FILE its own process, so requiring
// server.js (which connects mongoose at load time) is safe to do once per file.
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createMiniRedis } = require('./miniredis');

const BACKEND = path.join(__dirname, '..', '..');

async function waitForMongo(mongoose, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (mongoose.connection.readyState !== 1) {
        if (Date.now() > deadline) throw new Error('MongoDB did not connect in time');
        await new Promise((r) => setTimeout(r, 25));
    }
    // Let the boot tasks (counter sync, admin promotion, expiry audit) settle
    await new Promise((r) => setTimeout(r, 150));
}

/**
 * @param {object} env  extra environment for this run. A value of `undefined`
 *                      deletes the variable, which is how a test asks for
 *                      "JWT_SECRET is not configured".
 */
async function startHarness(env = {}) {
    const redis = createMiniRedis();
    await new Promise((r) => redis.server.listen(0, '127.0.0.1', r));

    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri('pixellink');

    // Stops server.js binding its own port; the harness supplies one below
    process.env.NODE_ENV = 'test';

    const applyEnv = () => {
        process.env.MONGO_URI = uri;
        process.env.REDIS_URL = 'redis://127.0.0.1:' + redis.server.address().port;
        process.env.JWT_SECRET = 'test-secret';
        delete process.env.ADMIN_KEY;
        delete process.env.ADMIN_EMAIL;
        delete process.env.BASE_URL;
        delete process.env.GUEST_LINK_TTL_DAYS;
        delete process.env.ALLOW_DELETE_ALL;

        // Rate limits would otherwise make tests order-dependent: registering a
        // sixth account in one file would trip the real 5/hour cap. A test that
        // asserts limiting works sets its own low value.
        process.env.RATE_LIMIT_REGISTER_MAX = '1000';
        process.env.RATE_LIMIT_AUTH_MAX = '1000';
        process.env.RATE_LIMIT_SHORTEN_MAX = '1000';
        process.env.RATE_LIMIT_API_MAX = '10000';

        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };

    // Once before the require, because server.js needs MONGO_URI at boot...
    applyEnv();

    const app = require(path.join(BACKEND, 'server.js'));
    const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));

    // ...and again afterwards, because server.js calls dotenv.config(), which
    // repopulates whatever the developer happens to have in backend/.env.
    // Every config accessor reads process.env lazily, so this takes effect.
    applyEnv();

    await waitForMongo(mongoose);

    const listener = app.listen(0, '127.0.0.1');
    await new Promise((r) => listener.once('listening', r));
    const base = 'http://127.0.0.1:' + listener.address().port;

    // Each session keeps its own cookie jar, so one test can act as several
    // different people (a guest, a user, an admin) at the same time.
    const session = () => {
        let jar = '';
        const call = async (p, options = {}) => {
            const headers = Object.assign(
                { 'Content-Type': 'application/json' },
                jar ? { Cookie: jar } : {},
                options.headers || {}
            );
            const res = await fetch(base + p, Object.assign({}, options, { redirect: 'manual', headers }));
            const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
            for (const c of setCookie) {
                if (c.startsWith('pl_session=')) jar = c.split(';')[0];
            }
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch (_) { body = text; }
            return {
                status: res.status,
                body,
                location: res.headers.get('location'),
                setCookie
            };
        };

        return {
            call,
            get: (p, o) => call(p, o),
            post: (p, data, o) => call(p, Object.assign({ method: 'POST', body: JSON.stringify(data) }, o || {})),
            del: (p, o) => call(p, Object.assign({ method: 'DELETE' }, o || {})),
            register: (email, password = 'password123') =>
                call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
            login: (email, password = 'password123') =>
                call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
            shorten: (url, customCode) =>
                call('/api/shorten', {
                    method: 'POST',
                    body: JSON.stringify(customCode ? { url, customCode } : { url })
                }),
            clearCookies: () => { jar = ''; }
        };
    };

    return {
        base,
        session,
        mongoose,
        uri,
        cache: redis.store,
        cacheTtls: redis.ttls,
        models: {
            Url: require(path.join(BACKEND, 'models', 'Url.js')),
            User: require(path.join(BACKEND, 'models', 'User.js'))
        },
        // Raw collection access, for asserting on fields Mongoose would hide
        raw: (name) => mongoose.connection.db.collection(name),
        async stop() {
            await new Promise((r) => listener.close(r));

            // Disconnect the app's own Redis client BEFORE tearing down the
            // fake server, otherwise ioredis spins on reconnect timers and the
            // test process never exits.
            const client = require(path.join(BACKEND, 'config', 'redis.js'));
            try {
                if (typeof client.quit === 'function') await client.quit();
            } catch (_) { /* already gone */ }
            if (typeof client.disconnect === 'function') client.disconnect();

            await mongoose.disconnect().catch(() => {});
            redis.server.close();
            await mongod.stop();
        }
    };
}

module.exports = { startHarness };
