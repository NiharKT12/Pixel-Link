const redis = require('../config/redis');
const Url = require('../models/Url');
const Counter = require('../models/Counter');

const COUNTER_KEY = 'url_counter';
const COUNTER_ID = 'url';

// Atomic counter in MongoDB - the durable fallback when Redis is missing or down
async function nextIdFromMongo() {
    const counter = await Counter.findOneAndUpdate(
        { _id: COUNTER_ID },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
    );
    return counter.seq;
}

// Allocate the next numeric id.
//
// Redis is the fast path. If it is disabled or unreachable we fall back to
// MongoDB rather than failing the request - shortening keeps working.
async function nextId() {
    if (!redis.enabled) return nextIdFromMongo();

    try {
        return await redis.incr(COUNTER_KEY);
    } catch (err) {
        console.error('⚠️  Redis counter unavailable, falling back to MongoDB:', err.message);
        return nextIdFromMongo();
    }
}

// Both counters must sit above the highest id already stored, otherwise a
// wiped or recreated Redis (common on free tiers) restarts at 1 and every
// insert dies on the unique index. Run once at boot.
async function syncCounters() {
    const highest = await Url.findOne().sort({ numericId: -1 }).select('numericId').lean();
    const floor = highest ? highest.numericId : 0;

    await Counter.updateOne(
        { _id: COUNTER_ID },
        { $max: { seq: floor } },
        { upsert: true }
    );

    if (!redis.enabled) {
        console.log(`🔢 Id counter served by MongoDB, starting above ${floor}`);
        return;
    }

    try {
        const current = Number(await redis.get(COUNTER_KEY)) || 0;
        if (current < floor) {
            await redis.set(COUNTER_KEY, floor);
            console.log(`🔄 Redis counter reseeded to ${floor}`);
        }
    } catch (err) {
        console.error('⚠️  Could not sync Redis counter:', err.message);
    }
}

module.exports = { nextId, syncCounters, nextIdFromMongo, COUNTER_KEY };
