const mongoose = require('mongoose');

const urlSchema = new mongoose.Schema({
    originalUrl: {
        type: String,
        required: true,
        // Indexed for the dedupe lookup on every shorten request
        index: true
    },
    shortCode: {
        type: String,
        required: true,
        // `unique` already builds the index; adding `index: true` too
        // would create a duplicate-index warning
        unique: true
    },
    numericId: {
        type: Number,
        required: true,
        unique: true
    },
    clicks: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Url', urlSchema);
