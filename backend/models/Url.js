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
    isCustom: {
        type: Boolean,
        default: false
    },
    // Null means nobody owns this link: either it predates accounts, or a
    // guest created it. Unowned links are invisible to every user dashboard.
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // Set on insert for guest links only, and NEVER backfilled. A TTL index
    // (added in a later phase) ignores documents where this field is absent,
    // which is exactly what keeps existing links alive forever.
    expiresAt: {
        type: Date,
        default: undefined
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

// TTL index. With expireAfterSeconds: 0, MongoDB deletes a document once the
// date in expiresAt passes. Documents where the field is MISSING or null are
// never touched - which is what makes every pre-existing link immortal with
// no backfill. Never write expiresAt onto old rows.
//
// The sweep runs roughly once a minute, so expiry is approximate; the
// redirect handler also filters on expiresAt, and the cache clamps its TTL.
urlSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Backs the per-owner dashboard listing, which sorts newest first
urlSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Url', urlSchema);
