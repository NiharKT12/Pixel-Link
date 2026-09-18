const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const cache = require('../lib/cache');
const { encodeId, validateCustomCode } = require('../lib/shortcode');
const { nextId } = require('../lib/ids');
const { baseUrl, guestExpiresAt } = require('../lib/config');
const { shortenLimiter } = require('../middleware/rateLimit');
const { requireAdmin } = require('../middleware/auth');
const { listLinks } = require('../lib/listLinks');

// Validate URL format
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
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

    // null for guests. Only guest links get an expiry - an owned link
    // leaves the field absent, which a TTL index ignores entirely.
    const ownerId = req.user ? req.user._id : null;
    const expiresAt = ownerId ? undefined : guestExpiresAt() || undefined;

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
                    isCustom: true,
                    owner: ownerId,
                    expiresAt
                }).save();
            } catch (err) {
                // Lost a race against a concurrent request for the same name
                if (err.code === 11000) {
                    return res.status(409).json({ error: `"${wanted}" is already taken` });
                }
                throw err;
            }

            await cache.setLink(saved.shortCode, url, saved.expiresAt);

            return res.status(201).json({
                shortUrl: `${baseUrl()}/${saved.shortCode}`,
                shortCode: saved.shortCode,
                isCustom: true,
                expiresAt: saved.expiresAt || null
            });
        }

        // Check if this owner already shortened this URL.
        //
        // Scoping by owner matters: unscoped, a signed-in user shortening a URL
        // some guest had already shortened would be handed the guest's link -
        // which then silently expires out from under them.
        const existingUrl = await Url.findOne({
            originalUrl: url,
            isCustom: { $ne: true },
            owner: ownerId
        });

        if (existingUrl) {
            // Re-shortening a guest link renews its lifetime, so an active
            // link is never handed back about to expire. $max never shortens.
            if (expiresAt && existingUrl.expiresAt) {
                await Url.updateOne({ _id: existingUrl._id }, { $max: { expiresAt } });
                existingUrl.expiresAt = new Date(Math.max(expiresAt, existingUrl.expiresAt));
                await cache.setLink(existingUrl.shortCode, existingUrl.originalUrl, existingUrl.expiresAt);
            }

            return res.json({
                shortUrl: `${baseUrl()}/${existingUrl.shortCode}`,
                shortCode: existingUrl.shortCode,
                isCustom: false,
                expiresAt: existingUrl.expiresAt || null
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
                saved = await new Url({ originalUrl: url, shortCode, numericId, owner: ownerId, expiresAt }).save();
            } catch (err) {
                if (err.code !== 11000) throw err;
                lastError = err;
                console.warn(`⚠️  Duplicate code ${shortCode}, retrying (attempt ${attempt + 1})`);
            }
        }

        if (!saved) throw lastError;

        await cache.setLink(saved.shortCode, url, saved.expiresAt);

        res.status(201).json({
            shortUrl: `${baseUrl()}/${saved.shortCode}`,
            shortCode: saved.shortCode,
            isCustom: false,
            expiresAt: saved.expiresAt || null
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
        res.json(await listLinks({}, req.query));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
