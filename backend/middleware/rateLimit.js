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

module.exports = { shortenLimiter, apiLimiter };
