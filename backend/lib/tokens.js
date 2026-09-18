const jwt = require('jsonwebtoken');
const { jwtSecret, isProd } = require('./config');

const COOKIE_NAME = 'pl_session';
const MAX_AGE_DAYS = 14;

// Claims stay minimal: the subject and the token version, nothing else.
// Notably NO role - admin routes re-read the role from MongoDB on every
// request, so revoking admin takes effect immediately instead of waiting for
// a 14-day token to expire.
function signToken(user) {
    return jwt.sign(
        { sub: String(user._id), v: user.tokenVersion || 0 },
        jwtSecret(),
        { expiresIn: `${MAX_AGE_DAYS}d`, algorithm: 'HS256' }
    );
}

// Returns the payload, or null for anything invalid, expired or tampered.
// Never throws - callers treat null as "not signed in".
function verifyToken(token) {
    if (!token) return null;

    try {
        return jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    } catch (_) {
        return null;
    }
}

// httpOnly so injected script cannot read it; sameSite 'lax' is sufficient
// because the API is same-origin with the pages (proxied through Vercel).
// No `domain` attribute - vercel.app is on the Public Suffix List, so the
// cookie must stay host-only.
function cookieOptions() {
    return {
        httpOnly: true,
        secure: isProd(),
        sameSite: 'lax',
        path: '/',
        maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    };
}

function setSessionCookie(res, user) {
    res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
}

function clearSessionCookie(res) {
    const { maxAge, ...opts } = cookieOptions();
    res.clearCookie(COOKIE_NAME, opts);
}

module.exports = {
    COOKIE_NAME,
    signToken,
    verifyToken,
    cookieOptions,
    setSessionCookie,
    clearSessionCookie
};
