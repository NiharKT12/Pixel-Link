const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const urlRoutes = require('./routes/url');
const redis = require('./config/redis');
const Url = require('./models/Url');
const { isValidCode } = require('./lib/shortcode');
const { syncCounters } = require('./lib/ids');
const { cacheTtl, corsOrigin, port } = require('./lib/config');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

// Render terminates TLS upstream; without this the rate limiter sees one shared IP
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: corsOrigin() }));
app.use(express.json({ limit: '10kb' }));

// Root route
app.get('/', (req, res) => {
    res.json({ message: 'Pixel Link API is running', endpoints: {
        shorten: 'POST /api/shorten',
        redirect: 'GET /:code',
        stats: 'GET /api/stats/:code',
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

// Routes
app.use('/api', apiLimiter, urlRoutes);

// Redirect route - must be after /api routes
app.get('/:code', async (req, res, next) => {
    const { code } = req.params;
    const TTL = cacheTtl();

    // Anything that cannot be a short code (favicon.ico, scanner noise) is
    // rejected before it costs a database round trip
    if (!isValidCode(code)) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    try {
        // Check Redis cache first. Cache failures degrade to a database read
        // rather than breaking the redirect.
        let cachedUrl = null;
        try {
            cachedUrl = await redis.get(`url:${code}`);
        } catch (err) {
            console.error('⚠️  Cache read failed:', err.message);
        }

        if (cachedUrl) {
            // Reset TTL on access (keep popular links cached)
            redis.expire(`url:${code}`, TTL).catch((err) => {
                console.error('⚠️  Cache TTL refresh failed:', err.message);
            });

            // Increment click count in background (don't wait). The catch is
            // required: an unhandled rejection here would take down the process.
            Url.updateOne({ shortCode: code }, { $inc: { clicks: 1 } })
                .exec()
                .catch((err) => console.error('⚠️  Click increment failed:', err.message));

            return res.redirect(cachedUrl);
        }

        // Not in cache, check MongoDB - and count the click in the same
        // atomic update so concurrent redirects cannot lose increments
        const urlDoc = await Url.findOneAndUpdate(
            { shortCode: code },
            { $inc: { clicks: 1 } },
            { new: true }
        );

        if (!urlDoc) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        // Cache the result with TTL
        try {
            await redis.set(`url:${code}`, urlDoc.originalUrl, 'EX', TTL);
        } catch (err) {
            console.error('⚠️  Cache write failed:', err.message);
        }

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

// Connect to MongoDB and start server
const PORT = port();

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB');

        // Counters must clear the highest stored id before the first request
        await syncCounters();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
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
