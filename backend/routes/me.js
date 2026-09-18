const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const cache = require('../lib/cache');
const { listLinks } = require('../lib/listLinks');
const { baseUrl } = require('../lib/config');
const { requireUser } = require('../middleware/auth');
const { isValidCode } = require('../lib/shortcode');

// Everything here is per-user and requires a session
router.use(requireUser);

// GET /api/me/urls - the signed-in user's own links
router.get('/urls', async (req, res, next) => {
    try {
        const page = await listLinks({ owner: req.user._id }, req.query);

        res.json({
            ...page,
            baseUrl: baseUrl(),
            urls: page.urls.map((u) => ({
                shortCode: u.shortCode,
                originalUrl: u.originalUrl,
                clicks: u.clicks,
                isCustom: u.isCustom,
                expiresAt: u.expiresAt || null,
                createdAt: u.createdAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/me/urls/:code - delete one of the user's own links
router.delete('/urls/:code', async (req, res, next) => {
    const { code } = req.params;

    if (!isValidCode(code)) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    try {
        // The owner is part of the filter, so someone else's link simply does
        // not match. Returning 404 rather than 403 avoids confirming that a
        // code exists at all.
        const deleted = await Url.findOneAndDelete({ shortCode: code, owner: req.user._id });

        if (!deleted) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        // Without this the link keeps redirecting from cache for up to an hour
        // after the user watched it disappear from their dashboard
        await cache.delLink(code);

        res.json({ ok: true, shortCode: code });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
