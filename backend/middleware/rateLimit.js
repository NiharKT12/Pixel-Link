const rateLimit = require('express-rate-limit');

// Limits are tunable by environment so they can be tightened during an abuse
// spike, or relaxed in tests, without editing code. The defaults are the
// production values.
function max(name, fallback) {
    const parsed = parseInt(process.env['RATE_LIMIT_' + name + '_MAX'], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Writes are the expensive path - one script can otherwise fill the database.
const shortenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: max('SHORTEN', 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many links created from this IP, please try again later' }
});

// Generous ceiling for reads, enough to blunt scraping without affecting real use.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: max('API', 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
});

// Login is the most brute-forceable endpoint in the app.
// skipSuccessfulRequests means a legitimate user signing in repeatedly is
// never locked out by their own activity - only failures count.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: max('AUTH', 10),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' }
});

// Registration is cheap to abuse and expensive to clean up.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: max('REGISTER', 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this IP, please try again later' }
});

module.exports = { shortenLimiter, apiLimiter, authLimiter, registerLimiter };
