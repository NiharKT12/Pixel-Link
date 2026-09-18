const redis = require('../config/redis');
const { cacheTtl } = require('./config');

// Key prefix. Bumped from "url:" when the payload changed from a bare URL
// string to JSON - old keys are simply never read and age out on their own
// TTL, so no dual-format reader and no migration are needed.
const PREFIX = 'url2:';

function key(shortCode) {
    return PREFIX + shortCode;
}

// Seconds a link may stay cached: never longer than the link itself lives.
// Returns 0 when the link is already dead, meaning "do not cache".
function effectiveTtl(expiresAt) {
    const max = cacheTtl();
    if (!expiresAt) return max;

    const remaining = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    if (remaining <= 0) return 0;

    return Math.min(max, remaining);
}

// Read a cached link. Returns the original URL, or null for a miss.
//
// A cache failure is a miss, never an error - the caller falls through to
// MongoDB. An entry whose own expiry has passed is evicted and reported as a
// miss: MongoDB fires no hook when a TTL index deletes a document, so this is
// the only thing standing between a silently expired link and a cache that
// would otherwise keep serving it.
async function getLink(shortCode) {
    let raw;
    try {
        raw = await redis.get(key(shortCode));
    } catch (err) {
        console.error('⚠️  Cache read failed:', err.message);
        return null;
    }

    if (!raw) return null;

    let entry;
    try {
        entry = JSON.parse(raw);
    } catch (_) {
        // Not our format - treat as a miss and let it be overwritten
        return null;
    }

    if (!entry || typeof entry.u !== 'string') return null;

    if (entry.e && entry.e <= Date.now()) {
        await delLink(shortCode);
        return null;
    }

    // Refresh the TTL so popular links stay cached, but never past the point
    // where the link itself expires
    const ttl = effectiveTtl(entry.e);
    if (ttl > 0) {
        redis.expire(key(shortCode), ttl).catch((err) => {
            console.error('⚠️  Cache TTL refresh failed:', err.message);
        });
    }

    return entry.u;
}

// Cache a link. Never throws - the link is already durable in MongoDB, so a
// cache write failure must not fail the request.
async function setLink(shortCode, originalUrl, expiresAt = null) {
    const ttl = effectiveTtl(expiresAt);
    if (ttl <= 0) return;

    const payload = JSON.stringify({
        u: originalUrl,
        e: expiresAt ? new Date(expiresAt).getTime() : null
    });

    try {
        await redis.set(key(shortCode), payload, 'EX', ttl);
    } catch (err) {
        console.error('⚠️  Cache write failed:', err.message);
    }
}

// Invalidate a single link. Logged loudly on failure: a missed invalidation
// leaves a deleted link still redirecting.
async function delLink(shortCode) {
    try {
        await redis.del(key(shortCode));
    } catch (err) {
        console.error(`⚠️  Cache invalidation failed for ${shortCode}:`, err.message);
    }
}

// Invalidate many links at once. Used after bulk deletes - never flush the
// whole database, which would also destroy the id counter.
async function delLinks(shortCodes) {
    if (!shortCodes || shortCodes.length === 0) return;

    try {
        await redis.del(...shortCodes.map(key));
    } catch (err) {
        console.error('⚠️  Bulk cache invalidation failed:', err.message);
    }
}

module.exports = { getLink, setLink, delLink, delLinks, effectiveTtl, PREFIX };
