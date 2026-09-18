const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const redis = require('../config/redis');
const { encodeId, validateCustomCode } = require('../lib/shortcode');
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

// Cache a link, but never fail the request over a cache write - the link is
// already durable in MongoDB by this point.
async function cacheLink(shortCode, url) {
    try {
        await redis.set(`url:${shortCode}`, url, 'EX', cacheTtl());
    } catch (err) {
        console.error('⚠️  Cache write failed:', err.message);
    }
}

// POST /api/shorten - Create short URL, optionally under a custom name
router.post('/shorten', shortenLimiter, async (req, res, next) => {
    const { url, customCode } = req.body || {};

    // Validate input
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Treat an empty/whitespace custom name as "not supplied"
    const wanted = typeof customCode === 'string' ? customCode.trim() : '';

    if (wanted) {
        const problem = validateCustomCode(wanted);
        if (problem) return res.status(400).json({ error: problem });
    }

    try {
        if (wanted) {
            // Custom names are explicit, so they always create a new link even
            // if this URL was shortened before.
            const taken = await Url.findOne({ shortCode: wanted }).select('_id').lean();
            if (taken) {
                return res.status(409).json({ error: `"${wanted}" is already taken` });
            }

            // A numericId is still allocated so the unique index holds and the
            // generated-code sequence keeps moving.
            const numericId = await nextId();

            let saved;
            try {
                saved = await new Url({
                    originalUrl: url,
                    shortCode: wanted,
                    numericId,
                    isCustom: true
                }).save();
            } catch (err) {
                // Lost a race against a concurrent request for the same name
                if (err.code === 11000) {
                    return res.status(409).json({ error: `"${wanted}" is already taken` });
                }
                throw err;
            }

            await cacheLink(saved.shortCode, url);

            return res.status(201).json({
                shortUrl: `${baseUrl()}/${saved.shortCode}`,
                shortCode: saved.shortCode,
                isCustom: true
            });
        }

        // Check if URL already exists
        const existingUrl = await Url.findOne({ originalUrl: url, isCustom: { $ne: true } });

        if (existingUrl) {
            return res.json({
                shortUrl: `${baseUrl()}/${existingUrl.shortCode}`,
                shortCode: existingUrl.shortCode,
                isCustom: false
            });
        }

        // Allocate an id and store the link. A duplicate-key error means the
        // counter had drifted behind the data, or the generated code collided
        // with a reserved custom name; retrying advances past the collision
        // instead of surfacing a 500.
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
                console.warn(`⚠️  Duplicate code ${shortCode}, retrying (attempt ${attempt + 1})`);
            }
        }

        if (!saved) throw lastError;

        await cacheLink(saved.shortCode, url);

        res.status(201).json({
            shortUrl: `${baseUrl()}/${saved.shortCode}`,
            shortCode: saved.shortCode,
            isCustom: false
        });

    } catch (error) {
        next(error);
    }
});

// GET /api/check/:code - Is this custom name available?
router.get('/check/:code', async (req, res, next) => {
    const code = req.params.code;
    const problem = validateCustomCode(code);

    if (problem) {
        return res.json({ code, available: false, reason: problem });
    }

    try {
        const taken = await Url.findOne({ shortCode: code }).select('_id').lean();
        res.json({
            code,
            available: !taken,
            reason: taken ? 'Already taken' : null
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
            isCustom: urlDoc.isCustom,
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
                .select('shortCode originalUrl clicks isCustom createdAt')
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
