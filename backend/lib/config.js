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

// Signs session tokens. Fails closed exactly like adminKey(): callers must
// treat an empty value as "auth is not configured" and return 503, never sign
// with a default secret.
function jwtSecret() {
    return process.env.JWT_SECRET || '';
}

// Email promoted to admin at boot, if that account exists.
function adminEmail() {
    return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

// How many proxies sit in front of the app. Render alone is 1; once the API is
// also proxied through Vercel it becomes 2. Getting this wrong makes req.ip
// resolve to a proxy address, which silently collapses every client into a
// single rate-limit bucket - hence the env override.
function trustProxyHops() {
    const parsed = parseInt(process.env.TRUST_PROXY_HOPS, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

// How long a guest link lives, in days. 0 (the default) disables expiry
// entirely, so the feature can be switched off by environment without a
// deploy. Only links with no owner are ever given an expiry.
function guestTtlDays() {
    const parsed = parseInt(process.env.GUEST_LINK_TTL_DAYS, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// The expiry stamp for a new guest link, or null when disabled.
function guestExpiresAt() {
    const days = guestTtlDays();
    return days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
}

// Bulk delete is the only irreversible operation in the app and there is no
// backup behind it, so it stays off unless deliberately switched on. A stolen
// admin session cannot wipe the database while this is false.
function allowDeleteAll() {
    return process.env.ALLOW_DELETE_ALL === 'true';
}

function isProd() {
    return process.env.NODE_ENV === 'production';
}

function port() {
    return parseInt(process.env.PORT, 10) || 5000;
}

module.exports = {
    cacheTtl,
    baseUrl,
    corsOrigin,
    adminKey,
    jwtSecret,
    adminEmail,
    trustProxyHops,
    allowDeleteAll,
    guestTtlDays,
    guestExpiresAt,
    isProd,
    port,
    DEFAULT_BASE_URL
};
