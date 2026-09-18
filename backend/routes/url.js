const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const redis = require('../config/redis');
const { encodeId } = require('../lib/shortcode');
const { nextId } = require('../lib/ids');
const { cacheTtl, baseUrl, adminKey } = require('../lib/config');
const { shortenLimiter } = require('../middleware/rateLimit');

// Validate URL format
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// Reject requests that only an authorised operator should make
function requireAdmin(req, res, next) {
    const key = adminKey();

    // Fail closed: an unset key locks the endpoint rather than opening it
    if (!key) {
        return res.status(503).json({ error: 'Admin endpoint is not configured' });
    }

    if (req.get('x-admin-key') !== key) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

// POST /api/shorten - Create short URL
router.post('/shorten', shortenLimiter, async (req, res, next) => {
    const { url } = req.body || {};
    const TTL = cacheTtl();

    // Validate input
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    try {
        // Check if URL already exists
        const existingUrl = await Url.findOne({ originalUrl: url });

        if (existingUrl) {
            return res.json({
                shortUrl: `${baseUrl()}/${existingUrl.shortCode}`,
                shortCode: existingUrl.shortCode
            });
        }

        // Allocate an id and store the link. A duplicate-key error means the
        // counter had drifted behind the data; retrying advances past the
        // collision instead of surfacing a 500.
        let saved = null;
        let lastError = null;

        for (let attempt = 0; attempt < 5 && !saved; attempt++) {
            const numericId = await nextId();
            const shortCode = encodeId(numericId);

            try {
                saved = await new Url({ originalUrl: url, shortCode, numericId }).save();
            } catch (err) {
                if (err.code !== 11000) throw err;
                lastError = err;
                console.warn(`⚠️  Duplicate id ${numericId}, retrying (attempt ${attempt + 1})`);
            }
        }

        if (!saved) throw lastError;

        // Cache in Redis with TTL. A cache write failure must not fail the
        // request - the link is already durable in MongoDB.
        try {
            await redis.set(`url:${saved.shortCode}`, url, 'EX', TTL);
        } catch (err) {
            console.error('⚠️  Cache write failed:', err.message);
        }

        res.status(201).json({
            shortUrl: `${baseUrl()}/${saved.shortCode}`,
            shortCode: saved.shortCode
        });

    } catch (error) {
        next(error);
    }
});

// GET /api/stats/:code - Get URL statistics
router.get('/stats/:code', async (req, res, next) => {
    try {
        const urlDoc = await Url.findOne({ shortCode: req.params.code });

        if (!urlDoc) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        res.json({
            originalUrl: urlDoc.originalUrl,
            shortCode: urlDoc.shortCode,
            clicks: urlDoc.clicks,
            createdAt: urlDoc.createdAt
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/urls - Paginated list of every link. Admin only: this exposes the
// full link space, so it is never reachable without the shared key.
router.get('/urls', requireAdmin, async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

        const [urls, totalLinks, totals] = await Promise.all([
            Url.find()
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('shortCode originalUrl clicks createdAt')
                .lean(),
            Url.countDocuments(),
            // Totals span the whole collection, not just this page
            Url.aggregate([{ $group: { _id: null, clicks: { $sum: '$clicks' } } }])
        ]);

        res.json({
            urls,
            page,
            limit,
            totalPages: Math.ceil(totalLinks / limit) || 1,
            totalLinks,
            totalClicks: totals[0] ? totals[0].clicks : 0
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
