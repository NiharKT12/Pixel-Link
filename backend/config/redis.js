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
