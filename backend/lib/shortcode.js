// Base62 character set
const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CODE_LENGTH = 5;
// 62^5 - the size of the code space we scramble within
const MODULUS = 62n ** BigInt(CODE_LENGTH);
// 3^18. Odd and not divisible by 31, so it is coprime with 62^5 (= 2^5 * 31^5),
// which makes multiplication modulo MODULUS a bijection: distinct ids always
// produce distinct codes, so scrambling never introduces collisions.
const MULTIPLIER = 387420489n;

// Custom aliases may also use - and _ and run longer than a generated code
const CUSTOM_MIN = 3;
const CUSTOM_MAX = 30;

// Paths the server itself owns, or that would be shadowed by a route or a
// static file. A custom alias matching one of these could never be reached.
const RESERVED_CODES = new Set([
    'api', 'health', 'admin', 'dashboard', 'index', 'app', 'static', 'assets',
    'public', 'favicon', 'robots', 'sitemap', 'www', 'login', 'logout',
    'signup', 'register', 'settings', 'about', 'privacy', 'terms', 'null',
    'undefined',
    // Reserved ahead of the accounts work, so nobody can claim a name that a
    // future page or endpoint will need
    'auth', 'account', 'me', 'user', 'users', 'session', 'signin', 'signout'
]);

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

// Cheap shape check so junk paths (/favicon.ico, scanner noise) never reach the
// database. Wide enough to cover custom aliases as well as generated codes.
const CODE_PATTERN = new RegExp(`^[0-9a-zA-Z_-]{1,${CUSTOM_MAX}}$`);

function isValidCode(code) {
    return CODE_PATTERN.test(code);
}

// Validate a user-supplied alias. Returns an error string, or null when valid.
function validateCustomCode(code) {
    if (typeof code !== 'string') return 'Custom name must be text';

    if (code.length < CUSTOM_MIN || code.length > CUSTOM_MAX) {
        return `Custom name must be ${CUSTOM_MIN}-${CUSTOM_MAX} characters`;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
        return 'Custom name can only use letters, numbers, hyphens and underscores';
    }

    if (RESERVED_CODES.has(code.toLowerCase())) {
        return 'That name is reserved, please pick another';
    }

    return null;
}

module.exports = {
    toBase62,
    encodeId,
    isValidCode,
    validateCustomCode,
    CHARSET,
    CUSTOM_MIN,
    CUSTOM_MAX,
    RESERVED_CODES
};
