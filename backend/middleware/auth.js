const User = require('../models/User');
const { verifyToken, COOKIE_NAME } = require('../lib/tokens');
const { adminKey, jwtSecret } = require('../lib/config');

// Populate req.user when a valid session cookie is present. Never rejects -
// anonymous requests are legitimate everywhere this is mounted (guests can
// still shorten links), so this only ever adds information.
async function attachUser(req, res, next) {
    req.user = null;

    if (!jwtSecret()) return next();

    const payload = verifyToken(req.cookies && req.cookies[COOKIE_NAME]);
    if (!payload || !payload.sub) return next();

    try {
        const user = await User.findById(payload.sub).select('-passwordHash');

        // A bumped tokenVersion means this session was deliberately revoked
        if (user && (user.tokenVersion || 0) === (payload.v || 0)) {
            req.user = user;
        }
    } catch (err) {
        // A database blip must not lock everyone out of anonymous features
        console.error('⚠️  Session lookup failed:', err.message);
    }

    next();
}

// Endpoints that need a signed-in user.
function requireUser(req, res, next) {
    if (!jwtSecret()) {
        return res.status(503).json({ error: 'Authentication is not configured' });
    }

    if (!req.user) {
        return res.status(401).json({ error: 'Sign in to continue' });
    }

    next();
}

// Admin access via either a session whose role is admin, or the pre-existing
// shared header secret. The header is kept deliberately as break-glass: it
// works from curl, survives a JWT_SECRET rotation, and gets you back in if the
// admin account is ever locked out. Browser pages must use the session only.
//
// Fails closed: with neither mechanism configured, nobody gets in.
function requireAdmin(req, res, next) {
    const key = adminKey();

    if (key && req.get('x-admin-key') === key) {
        req.isAdminKey = true;
        return next();
    }

    // Role is read from the database by attachUser, never from the token, so a
    // demotion takes effect on the very next request.
    if (req.user && req.user.role === 'admin') {
        return next();
    }

    if (!key && !jwtSecret()) {
        return res.status(503).json({ error: 'Admin access is not configured' });
    }

    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { attachUser, requireUser, requireAdmin };
