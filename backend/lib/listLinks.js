const Url = require('../models/Url');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Shared paginated listing, used by both the admin view (no filter) and a
// user's own links (filtered by owner). Totals always span the whole filtered
// set, not just the page being returned.
async function listLinks(filter = {}, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));

    const [urls, totalLinks, totals] = await Promise.all([
        Url.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select('shortCode originalUrl clicks isCustom owner expiresAt createdAt')
            .lean(),
        Url.countDocuments(filter),
        Url.aggregate([
            { $match: filter },
            { $group: { _id: null, clicks: { $sum: '$clicks' } } }
        ])
    ]);

    return {
        urls,
        page,
        limit,
        totalPages: Math.ceil(totalLinks / limit) || 1,
        totalLinks,
        totalClicks: totals[0] ? totals[0].clicks : 0
    };
}

module.exports = { listLinks, DEFAULT_LIMIT, MAX_LIMIT };
