const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// scrypt from node:crypto rather than bcrypt/argon2: no native build to break
// on a free-tier deploy, and it runs on libuv's threadpool so hashing does not
// block the event loop.
const N = 16384;   // CPU/memory cost - ~16MB per hash
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

// Stored as scrypt$N$r$p$salt$hash. The algorithm prefix means the parameters
// can be raised, or the algorithm swapped, without a flag day - old hashes
// stay verifiable because they carry their own settings.
async function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const derived = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P });

    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

// Constant-time comparison. Returns false for any malformed stored value
// rather than throwing, so a corrupt record cannot 500 the login endpoint.
async function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;

    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;

    try {
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');
        const derived = await scrypt(password, salt, expected.length, {
            N: Number(n),
            r: Number(r),
            p: Number(p)
        });

        return crypto.timingSafeEqual(derived, expected);
    } catch (_) {
        return false;
    }
}

module.exports = { hashPassword, verifyPassword };
