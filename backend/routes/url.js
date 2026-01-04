const express = require('express');
const router = express.Router();
const Url = require('../models/Url');
const redis = require('../config/redis');

// Base62 character set
const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Convert number to Base62
function toBase62(num) {
    if (num === 0) return CHARSET[0];
    
    let encoded = '';
    while (num > 0) {
        encoded = CHARSET[num % 62] + encoded;
        num = Math.floor(num / 62);
    }
    return encoded;
}

// Validate URL format
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// POST /api/shorten - Create short URL
router.post('/shorten', async (req, res) => {
    const { url } = req.body;
    const CACHE_TTL = process.env.CACHE_TTL || 3600;

    // Validate input
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    try {
        // Check if URL already exists
        const existingUrl = await Url.findOne({ originalUrl: url });
        
        if (existingUrl) {
            return res.json({
                shortUrl: `${req.protocol}://${req.get('host')}/${existingUrl.shortCode}`,
                shortCode: existingUrl.shortCode
            });
        }

        // Get unique ID from Redis counter
        const numericId = await redis.incr('url_counter');
        
        // Convert to Base62
        const shortCode = toBase62(numericId);

        // Save to MongoDB
        const newUrl = new Url({
            originalUrl: url,
            shortCode,
            numericId
        });
        await newUrl.save();

        // Cache in Redis with TTL
        await redis.set(`url:${shortCode}`, url, 'EX', CACHE_TTL);

        res.status(201).json({
            shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`,
            shortCode
        });

    } catch (error) {
        console.error('Shorten error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/stats/:code - Get URL statistics (optional)
router.get('/stats/:code', async (req, res) => {
    try {
        const urlDoc = await Url.findOne({ shortCode: req.params.code });
        
        if (!urlDoc) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        res.json({
            originalUrl: urlDoc.originalUrl,
            shortCode: urlDoc.shortCode,
            clicks: urlDoc.clicks,
            createdAt: urlDoc.createdAt
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/urls - Get all URLs for dashboard
router.get('/urls', async (req, res) => {
    try {
        const urls = await Url.find()
            .sort({ createdAt: -1 })
            .select('shortCode originalUrl clicks createdAt');
        
        const totalClicks = urls.reduce((sum, url) => sum + url.clicks, 0);

        res.json({
            urls,
            totalLinks: urls.length,
            totalClicks
        });
    } catch (error) {
        console.error('Fetch URLs error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
