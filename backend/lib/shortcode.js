// Base62 character set
const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CODE_LENGTH = 5;
// 62^5 - the size of the code space we scramble within
const MODULUS = 62n ** BigInt(CODE_LENGTH);
// 3^18. Odd and not divisible by 31, so it is coprime with 62^5 (= 2^5 * 31^5),
// which makes multiplication modulo MODULUS a bijection: distinct ids always
// produce distinct codes, so scrambling never introduces collisions.
const MULTIPLIER = 387420489n;

// Convert a non-negative integer to Base62
function toBase62(num) {
    let n = BigInt(num);
    if (n === 0n) return CHARSET[0];

    let encoded = '';
    while (n > 0n) {
        encoded = CHARSET[Number(n % 62n)] + encoded;
        n = n / 62n;
    }
    return encoded;
}

// Turn a sequential numeric id into a non-sequential short code, so the link
// space cannot be walked by simply incrementing a code.
function encodeId(numericId) {
    const id = BigInt(numericId);

    // Past the code space we fall back to plain Base62, which stays unique
    // because numericId is unique - it just grows to 6+ characters.
    if (id >= MODULUS) return toBase62(id);

    return toBase62((id * MULTIPLIER) % MODULUS).padStart(CODE_LENGTH, CHARSET[0]);
}

// Cheap shape check so junk paths (/favicon.ico, scanner noise) never reach the database
const CODE_PATTERN = /^[0-9a-zA-Z]{1,12}$/;

function isValidCode(code) {
    return CODE_PATTERN.test(code);
}

module.exports = { toBase62, encodeId, isValidCode, CHARSET };
