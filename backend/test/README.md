# Tests

```bash
cd backend
npm test                    # ~20s
RUN_SLOW_TESTS=1 npm test   # adds the ~60s TTL sweep
```

No running MongoDB or Redis is needed. Each test file boots the **real**
`server.js` against an in-memory MongoDB (`mongodb-memory-server`) and a small
in-process Redis server (`helpers/miniredis.js`), so these exercise the actual
app rather than a stand-in.

The first run downloads a MongoDB binary (~100MB) into `node_modules/.cache`.
That download is deliberately **not** run on `npm install` — see
`config.mongodbMemoryServer.disablePostinstall` in `package.json` — so deploys
are not slowed by a dependency only the tests use.

## Layout

| File | Covers |
|---|---|
| `cache.test.js` | Cache keys, TTL clamping, self-eviction, degrading with no Redis |
| `auth.test.js` | Register, login, cookies, token integrity, lockout, admin role |
| `auth-disabled.test.js` | Failing closed with no `JWT_SECRET`; the break-glass key |
| `ownership.test.js` | Link ownership, owner-scoped dedupe, delete + cache invalidation |
| `admin.test.js` | Admin access control, filters, search, bulk-delete gates |
| `expiry.test.js` | Guest expiry, grandfathering, the kill switch |
| `ratelimit.test.js` | That the limiters actually fire |
| `ttl-sweep.test.js` | That MongoDB really deletes expired links (slow, opt-in) |

## Things worth knowing before editing

- **One harness per process.** `server.js` and `mongoose` are module-level
  singletons, so a second `startHarness()` in the same file silently keeps
  using the first database. Node gives each *file* its own process, so a test
  needing different configuration belongs in a new file — that is why
  `auth-disabled` and `ttl-sweep` are separate.

- **`server.js` calls `dotenv.config()`**, which loads your personal
  `backend/.env`. The harness therefore applies its environment twice: once
  before the require (MongoDB needs it at boot) and once after (to overwrite
  whatever `.env` injected). Without the second pass, a developer with
  `JWT_SECRET` set locally would see `auth-disabled.test.js` fail.

- **Rate limits are env-tunable** (`RATE_LIMIT_AUTH_MAX` and friends, defaults
  unchanged). The harness raises them so tests are not order-dependent;
  `ratelimit.test.js` lowers them deliberately.

- Tests run with `--test-concurrency=1`. Each spins up its own MongoDB, and
  running several at once is slower, not faster, on a laptop.
