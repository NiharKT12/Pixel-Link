const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../lib/password');
const { setSessionCookie, clearSessionCookie } = require('../lib/tokens');
const { jwtSecret } = require('../lib/config');
const { authLimiter, registerLimiter } = require('../middleware/rateLimit');
const { requireUser } = require('../middleware/auth');

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

// Deliberately identical for "no such account" and "wrong password" so the
// endpoint cannot be used to discover which emails are registered.
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

// Refuse to operate rather than sign tokens with an undefined secret
function requireAuthConfigured(req, res, next) {
    if (!jwtSecret()) {
        return res.status(503).json({ error: 'Authentication is not configured' });
    }
    next();
}

function isValidEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validatePassword(value) {
    if (typeof value !== 'string') return 'Password is required';
    if (value.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
    if (value.length > MAX_PASSWORD) return `Password must be under ${MAX_PASSWORD} characters`;
    return null;
}

function publicUser(user) {
    return { id: user._id, email: user.email, role: user.role, createdAt: user.createdAt };
}

router.use(requireAuthConfigured);

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res, next) => {
    const { email, password } = req.body || {};

    // Normalise before validating - a pasted address often carries trailing
    // whitespace, and rejecting that as "invalid email" is just confusing
    const normalised = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!isValidEmail(normalised)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }

    const problem = validatePassword(password);
    if (problem) return res.status(400).json({ error: problem });

    try {
        const passwordHash = await hashPassword(password);

        let user;
        try {
            user = await User.create({ email: normalised, passwordHash });
        } catch (err) {
            // Unique index is the authority on "already registered" - checking
            // first then inserting would race
            if (err.code === 11000) {
                return res.status(409).json({ error: 'That email is already registered' });
            }
            throw err;
        }

        setSessionCookie(res, user);
        res.status(201).json({ user: publicUser(user) });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res, next) => {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    try {
        const user = await User.findOne({ email: email.trim().toLowerCase() });

        // Hash even when the user does not exist, so response timing does not
        // reveal whether the account is registered
        if (!user) {
            await hashPassword(password);
            return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
        }

        if (user.isLocked()) {
            return res.status(429).json({
                error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`
            });
        }

        const valid = await verifyPassword(password, user.passwordHash);

        if (!valid) {
            // Durable counter: survives the instance restarts that reset the
            // in-memory rate limiter
            user.failedLogins = (user.failedLogins || 0) + 1;
            if (user.failedLogins >= MAX_FAILED_LOGINS) {
                user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
                user.failedLogins = 0;
            }
            await user.save();

            return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
        }

        if (user.failedLogins || user.lockedUntil) {
            user.failedLogins = 0;
            user.lockedUntil = null;
            await user.save();
        }

        setSessionCookie(res, user);
        res.json({ user: publicUser(user) });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireUser, (req, res) => {
    res.json({ user: publicUser(req.user) });
});

module.exports = router;
