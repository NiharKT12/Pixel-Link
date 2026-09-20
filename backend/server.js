const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const urlRoutes = require('./routes/url');
const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const adminRoutes = require('./routes/admin');
const redis = require('./config/redis');
const Url = require('./models/Url');
const { isValidCode } = require('./lib/shortcode');
const { syncCounters } = require('./lib/ids');
const cache = require('./lib/cache');
const { corsOrigin, port, trustProxyHops, adminEmail, jwtSecret, guestTtlDays } = require('./lib/config');
const { attachUser } = require('./middleware/auth');
const User = require('./models/User');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

// Number of proxies in front of the app. Render alone is 1; with the API also
// proxied through Vercel it is 2. If this is too low, req.ip resolves to a
// proxy address and EVERY client shares one rate-limit bucket - verify with
// GET /debug/ip after any change to the routing path.
app.set('trust proxy', trustProxyHops());

// Middleware
// credentials allows the session cookie on the cross-origin fallback path;
// once the API is proxied through Vercel the browser is same-origin anyway.
app.use(cors({ origin: corsOrigin(), credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Root route
app.get('/', (req, res) => {
    res.json({ message: 'Pixel Link API is running', endpoints: {
        shorten: 'POST /api/shorten',
        redirect: 'GET /:code',
        stats: 'GET /api/stats/:code',
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me',
        health: 'GET /health'
    }});
});

// Health check - also used to warm the instance after a cold start
app.get('/health', async (req, res) => {
    const mongoUp = mongoose.connection.readyState === 1;

    let redisState = 'disabled';
    if (redis.enabled) {
        try {
            redisState = (await redis.ping()) === 'PONG' ? 'up' : 'down';
        } catch (_) {
            redisState = 'down';
        }
    }

    // Redis is a cache, not a dependency: the service is still usable without it
    res.status(mongoUp ? 200 : 503).json({
        status: mongoUp ? 'ok' : 'degraded',
        mongo: mongoUp ? 'up' : 'down',
        redis: redisState,
        uptime: Math.round(process.uptime())
    });
});

// Public, non-sensitive settings the frontend needs in order to describe itself
// accurately - chiefly whether guest links actually expire on this deployment,
// so the UI never promises an expiry that is switched off (or stays silent
// about one that is switched on).
app.get('/api/config', (req, res) => {
    res.json({
        guestLinkTtlDays: guestTtlDays(),
        accountsEnabled: Boolean(jwtSecret())
    });
});

// Diagnostic for the trust-proxy setting. Returns what the app believes the
// client IP is - if this is not your real address, rate limiting is broken.
app.get('/debug/ip', (req, res) => {
    res.json({
        ip: req.ip,
        ips: req.ips,
        xForwardedFor: req.get('x-forwarded-for') || null,
        trustProxyHops: trustProxyHops()
    });
});

// Routes
//
// attachUser is mounted here rather than globally on purpose. It verifies the
// session cookie and loads the user from MongoDB, and the redirect handler
// below is the hottest path in the app - mounting it globally meant every
// redirect by a signed-in visitor paid an extra database round trip for a
// value the redirect never reads.
app.use('/api', attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/me', apiLimiter, meRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api', apiLimiter, urlRoutes);

// Redirect route - must be after /api routes
app.get('/:code', async (req, res, next) => {
    const { code } = req.params;

    // Anything that cannot be a short code (favicon.ico, scanner noise) is
    // rejected before it costs a database round trip
    if (!isValidCode(code)) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    try {
        // Check the cache first. Failures and expired entries degrade to a
        // database read rather than breaking the redirect.
        const cachedUrl = await cache.getLink(code);

        if (cachedUrl) {
            // Increment click count in background (don't wait). The catch is
            // required: an unhandled rejection here would take down the process.
            Url.updateOne({ shortCode: code }, { $inc: { clicks: 1 } })
                .exec()
                .catch((err) => console.error('⚠️  Click increment failed:', err.message));

            return res.redirect(cachedUrl);
        }

        // Not in cache, check MongoDB - and count the click in the same
        // atomic update so concurrent redirects cannot lose increments.
        //
        // The expiry predicate matters: MongoDB's TTL sweep only runs about
        // once a minute, so an expired link can still be sitting in the
        // collection. `expiresAt: null` matches documents where the field is
        // absent too, so every legacy and owned link passes.
        const urlDoc = await Url.findOneAndUpdate(
            {
                shortCode: code,
                $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
            },
            { $inc: { clicks: 1 } },
            { new: true }
        );

        if (!urlDoc) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        await cache.setLink(code, urlDoc.originalUrl, urlDoc.expiresAt);

        res.redirect(urlDoc.originalUrl);
    } catch (error) {
        next(error);
    }
});

// 404 for everything else
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Central error handler - keeps internals out of responses
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({ error: 'Server error' });
});

// The TTL index deletes documents server-side with no hook and no recovery, so
// say out loud at every boot exactly how many links are exposed to it. A
// healthy deployment shows 0 already-past, because expiresAt is only ever
// written with a future date and is never backfilled onto existing rows.
async function auditExpiry() {
    try {
        const [withExpiry, alreadyPast] = await Promise.all([
            Url.countDocuments({ expiresAt: { $ne: null } }),
            Url.countDocuments({ expiresAt: { $ne: null, $lte: new Date() } })
        ]);

        const days = guestTtlDays();
        console.log(days > 0
            ? `⏳ Guest links expire after ${days} day(s)`
            : '⏳ Guest link expiry is DISABLED (set GUEST_LINK_TTL_DAYS to enable)');

        if (withExpiry > 0) {
            console.log(`   ${withExpiry} link(s) carry an expiry`);
        }

        if (alreadyPast > 0) {
            console.warn(`⚠️  ${alreadyPast} link(s) are already past their expiry and will be deleted by the TTL sweep within ~60s`);
        }
    } catch (err) {
        console.error('⚠️  Expiry audit failed:', err.message);
    }
}

// Promote a registered account to admin, if ADMIN_EMAIL names one. Idempotent
// and a no-op until that user registers normally - there is deliberately no
// endpoint that grants admin, and no admin password lives in the environment.
async function promoteAdmin() {
    const email = adminEmail();
    if (!email) return;

    try {
        const result = await User.updateOne({ email }, { $set: { role: 'admin' } });
        if (result.matchedCount) {
            console.log(`👑 ${email} is an admin`);
        } else {
            console.log(`ℹ️  ADMIN_EMAIL ${email} has not registered yet - promote on next boot`);
        }
    } catch (err) {
        console.error('⚠️  Admin promotion failed:', err.message);
    }
}

// Connect to MongoDB and start server
const PORT = port();

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB');

        // Counters must clear the highest stored id before the first request
        await syncCounters();

        // Auth fails closed rather than signing with a default secret, so say
        // so loudly at boot instead of letting every login 503 unexplained
        if (!jwtSecret()) {
            console.warn('⚠️  JWT_SECRET not set - accounts and login are disabled (/api/auth/* returns 503)');
        }

        await auditExpiry();
        await promoteAdmin();

        // Tests import this module to exercise the real app and bind their own
        // ephemeral port. Binding here as well would leave a handle open and
        // stop the test process from ever exiting.
        if (process.env.NODE_ENV !== 'test') {
            app.listen(PORT, () => {
                console.log(`🚀 Server running on http://localhost:${PORT}`);
            });
        }
    })
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Last-resort guards so an unexpected rejection is logged, not silently fatal
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

module.exports = app;
