const rateLimit = require('express-rate-limit');

// Writes are the expensive path - one script can otherwise fill the database.
const shortenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many links created from this IP, please try again later' }
});

// Generous ceiling for reads, enough to blunt scraping without affecting real use.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
});

// Login is the most brute-forceable endpoint in the app.
// skipSuccessfulRequests means a legitimate user signing in repeatedly is
// never locked out by their own activity - only failures count.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' }
});

// Registration is cheap to abuse and expensive to clean up.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this IP, please try again later' }
});

module.exports = { shortenLimiter, apiLimiter, authLimiter, registerLimiter };
