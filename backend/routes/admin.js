const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const User = require('../models/User');
const cache = require('../lib/cache');
const { listLinks } = require('../lib/listLinks');
const { baseUrl, allowDeleteAll } = require('../lib/config');
const { verifyPassword } = require('../lib/password');
const { requireAdmin } = require('../middleware/auth');
const { isValidCode } = require('../lib/shortcode');

router.use(requireAdmin);

// Translate the UI's filter names into a Mongo query. Anything unrecognised
// falls through to "everything" rather than erroring.
function buildFilter(query) {
    const filter = {};

    if (query.scope === 'unclaimed') {
        // Links with no account behind them: pre-accounts, or guest-created
        filter.owner = null;
    } else if (query.scope === 'owned') {
        filter.owner = { $ne: null };
    } else if (query.scope === 'custom') {
        filter.isCustom = true;
    } else if (query.scope === 'expiring') {
        filter.expiresAt = { $ne: null };
    }

    const search = typeof query.q === 'string' ? query.q.trim() : '';
    if (search) {
        // Escape so a user-supplied string is matched literally, never as a
        // regex (a pattern like "(a+)+" would otherwise be a CPU hazard)
        const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { shortCode: new RegExp(safe, 'i') },
            { originalUrl: new RegExp(safe, 'i') }
        ];
    }

    return filter;
}

// GET /api/admin/urls - every link, paginated, filterable
router.get('/urls', async (req, res, next) => {
    try {
        const page = await listLinks(buildFilter(req.query), req.query);

        // Attach owner emails without an N+1 query
        const ownerIds = [...new Set(page.urls.map((u) => u.owner).filter(Boolean).map(String))];
        const owners = ownerIds.length
            ? await User.find({ _id: { $in: ownerIds } }).select('email').lean()
            : [];
        const emailById = new Map(owners.map((o) => [String(o._id), o.email]));

        res.json({
            ...page,
            baseUrl: baseUrl(),
            urls: page.urls.map((u) => ({
                shortCode: u.shortCode,
                originalUrl: u.originalUrl,
                clicks: u.clicks,
                isCustom: u.isCustom,
                expiresAt: u.expiresAt || null,
                createdAt: u.createdAt,
                ownerEmail: u.owner ? emailById.get(String(u.owner)) || null : null
            }))
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/admin/stats - headline numbers for the admin dashboard
router.get('/stats', async (req, res, next) => {
    try {
        const [totalLinks, unclaimed, custom, expiring, totalUsers, clickTotals] = await Promise.all([
            Url.countDocuments(),
            Url.countDocuments({ owner: null }),
            Url.countDocuments({ isCustom: true }),
            Url.countDocuments({ expiresAt: { $ne: null } }),
            User.countDocuments(),
            Url.aggregate([{ $group: { _id: null, clicks: { $sum: '$clicks' } } }])
        ]);

        res.json({
            totalLinks,
            unclaimed,
            custom,
            expiring,
            totalUsers,
            totalClicks: clickTotals[0] ? clickTotals[0].clicks : 0
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/admin/urls/:code - delete any link, regardless of owner
router.delete('/urls/:code', async (req, res, next) => {
    const { code } = req.params;

    if (!isValidCode(code)) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    try {
        const deleted = await Url.findOneAndDelete({ shortCode: code });

        if (!deleted) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        await cache.delLink(code);

        res.json({ ok: true, shortCode: code });
    } catch (error) {
        next(error);
    }
});

// Scopes a bulk delete is allowed to target. There is deliberately no "match
// everything by default" - an absent or unknown scope is rejected, so a
// malformed request can never become a full wipe.
const BULK_SCOPES = {
    unclaimed: () => ({ owner: null }),
    expired: () => ({ expiresAt: { $ne: null, $lte: new Date() } }),
    user: (value) => ({ owner: value }),
    all: () => ({})
};

const BULK_LIMIT = 500;

// GET /api/admin/bulk-preview - what would a given scope destroy?
// The count returned here is what the client must echo back to confirm.
router.get('/bulk-preview', async (req, res, next) => {
    const build = BULK_SCOPES[req.query.scope];

    if (!build) {
        return res.status(400).json({ error: 'Unknown scope' });
    }

    try {
        const filter = build(req.query.owner);
        const count = await Url.countDocuments(filter);

        res.json({
            scope: req.query.scope,
            count,
            confirm: `DELETE ${count}`,
            enabled: allowDeleteAll(),
            batchLimit: BULK_LIMIT
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/admin/bulk-delete - irreversible, so every gate below is deliberate
router.post('/bulk-delete', async (req, res, next) => {
    if (!allowDeleteAll()) {
        return res.status(403).json({
            error: 'Bulk delete is disabled. Set ALLOW_DELETE_ALL=true to enable it.'
        });
    }

    const { scope, owner, confirm, password } = req.body || {};
    const build = BULK_SCOPES[scope];

    if (!build) {
        return res.status(400).json({ error: 'Unknown scope' });
    }

    try {
        // Step-up auth: the session cookie alone is not enough for a wipe.
        // Authenticating by x-admin-key already counts as step-up, since that
        // secret is not held by the browser.
        if (!req.isAdminKey) {
            const admin = await User.findById(req.user._id);
            if (typeof password !== 'string' || !(await verifyPassword(password, admin.passwordHash))) {
                return res.status(401).json({ error: 'Password confirmation failed' });
            }
        }

        const filter = build(owner);

        // The confirmation must match the CURRENT count, so a stale preview or
        // a blind client cannot fire this
        const count = await Url.countDocuments(filter);
        if (confirm !== `DELETE ${count}`) {
            return res.status(409).json({
                error: `Confirmation does not match. Expected "DELETE ${count}".`,
                expected: `DELETE ${count}`,
                count
            });
        }

        if (count === 0) {
            return res.json({ deleted: 0, remaining: 0 });
        }

        // Delete in capped batches: keeps each request inside the host's
        // timeout and lets the operator stop part-way through
        const doomed = await Url.find(filter).select('shortCode').limit(BULK_LIMIT).lean();
        const codes = doomed.map((d) => d.shortCode);

        await Url.deleteMany({ shortCode: { $in: codes } });

        // Never flushall - that would also destroy url_counter, and every
        // insert before the next restart would collide on numericId
        await cache.delLinks(codes);

        const remaining = await Url.countDocuments(filter);

        console.warn(`🗑️  Bulk delete (${scope}): removed ${codes.length}, ${remaining} remaining`);

        res.json({ deleted: codes.length, remaining });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
