const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        // `unique` already builds the index - adding `index: true` too would
        // trigger a duplicate-index warning (same convention as Url.js)
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    // Bumping this invalidates every existing session for this user - the one
    // piece of revocation a stateless token would otherwise give up.
    tokenVersion: {
        type: Number,
        default: 0
    },
    // Durable half of the login throttle. The in-memory rate limiter resets
    // whenever the free-tier instance spins down, so an attacker could simply
    // wait out an idle window; this half survives restarts and also resists an
    // attacker rotating IP addresses.
    failedLogins: {
        type: Number,
        default: 0
    },
    lockedUntil: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

userSchema.methods.isLocked = function isLocked() {
    return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

module.exports = mongoose.model('User', userSchema);
