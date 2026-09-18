// Environment access in one place, parsed to real types.
// Read lazily so dotenv is guaranteed to have loaded first.

function cacheTtl() {
    const parsed = parseInt(process.env.CACHE_TTL, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

// Public origin that short links are built from. Defaults to production so a
// deploy that forgets to set BASE_URL still hands out working links instead of
// localhost; local development overrides it in .env.
const DEFAULT_BASE_URL = 'https://pixink.vercel.app';

function baseUrl() {
    return (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

// Browser origin allowed to call the API. Unset means "allow any", which is
// only appropriate for local development.
function corsOrigin() {
    return process.env.FRONTEND_URL || '*';
}

function adminKey() {
    return process.env.ADMIN_KEY || '';
}

function port() {
    return parseInt(process.env.PORT, 10) || 5000;
}

module.exports = { cacheTtl, baseUrl, corsOrigin, adminKey, port, DEFAULT_BASE_URL };
