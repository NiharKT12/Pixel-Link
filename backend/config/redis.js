const Redis = require('ioredis');

// Redis is a cache and a fast id source - not a hard dependency. When
// REDIS_URL is unset we run in a disabled mode instead of letting ioredis
// fall back to localhost:6379 and retry forever against nothing.
function createDisabledClient() {
    console.warn('⚠️  REDIS_URL not set - running without cache (MongoDB only)');

    return {
        enabled: false,
        // A disabled cache is simply a permanent miss
        async get() { return null; },
        async set() { return 'OK'; },
        async expire() { return 0; },
        // del reports "nothing deleted" rather than throwing - cache
        // invalidation must keep working when there is no cache at all
        async del() { return 0; },
        // Never reached (callers check redis.enabled first), but a missing
        // method here would be a TypeError rather than a handled fallback
        async incr() { throw new Error('Redis is disabled'); },
        async ping() { return null; },
        async quit() { return 'OK'; }
    };
}

function createClient() {
    const client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true
    });

    client.enabled = true;

    client.on('connect', () => {
        console.log('✅ Connected to Redis');
    });

    client.on('error', (err) => {
        console.error('❌ Redis error:', err.message);
    });

    client.connect().catch((err) => {
        console.error('❌ Redis initial connect failed:', err.message);
    });

    return client;
}

module.exports = process.env.REDIS_URL ? createClient() : createDisabledClient();
