const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const urlRoutes = require('./routes/url');
const redis = require('./config/redis');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
    res.json({ message: 'Pixel Link API is running', endpoints: {
        shorten: 'POST /api/shorten',
        redirect: 'GET /:code',
        stats: 'GET /api/stats/:code'
    }});
});

// Routes
app.use('/api', urlRoutes);

// Redirect route - must be after /api routes
app.get('/:code', async (req, res) => {
    const { code } = req.params;
    const Url = require('./models/Url');
    const CACHE_TTL = process.env.CACHE_TTL || 3600;

    try {
        // Check Redis cache first
        const cachedUrl = await redis.get(`url:${code}`);
        
        if (cachedUrl) {
            // Reset TTL on access (keep popular links cached)
            await redis.expire(`url:${code}`, CACHE_TTL);
            
            // Increment click count in background (don't wait)
            Url.updateOne({ shortCode: code }, { $inc: { clicks: 1 } }).exec();
            
            return res.redirect(cachedUrl);
        }

        // Not in cache, check MongoDB
        const urlDoc = await Url.findOne({ shortCode: code });
        
        if (!urlDoc) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        // Cache the result with TTL
        await redis.set(`url:${code}`, urlDoc.originalUrl, 'EX', CACHE_TTL);

        // Increment click count
        urlDoc.clicks += 1;
        await urlDoc.save();

        res.redirect(urlDoc.originalUrl);
    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });
