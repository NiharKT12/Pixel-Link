# 🎮 Pixel Link

A retro pixel-art themed URL shortener with analytics dashboard.

![Pixel Link](https://img.shields.io/badge/Status-Live-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green) ![Redis](https://img.shields.io/badge/Redis-Cloud-red) ![License](https://img.shields.io/badge/License-MIT-blue)

## 🌐 Live Demo

- **Frontend:** [https://pixink.vercel.app](https://pixink.vercel.app)
- **Backend API:** [https://pixel-link-2xiq.onrender.com](https://pixel-link-2xiq.onrender.com)

## ✨ Features

- 🔗 **URL Shortening** - Convert long URLs into short, shareable links
- ✏️ **Custom Names** - Claim your own alias (`/summer-sale`) with live availability checking
- 👤 **Accounts** - Sign in to own your links, see their analytics, and delete them
- 🛡️ **Admin** - Search every link, see who owns it, delete any of them
- ⏳ **Guest Expiry** - Links made signed-out delete themselves after a week (opt-in)
- 📊 **Analytics Dashboard** - Track click counts for your shortened URLs
- ⚡ **Redis Caching** - Fast redirects with 1-hour TTL caching
- 🛡️ **Rate Limited** - Per-IP limits keep the API from being flooded
- ♿ **Accessible** - Labelled controls, keyboard-navigable dialog, reduced-motion support
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile
- 🎨 **Pixel Art Theme** - Retro gaming aesthetic with animations

## 🛠️ Tech Stack

### Frontend
- HTML5, CSS3, JavaScript
- Press Start 2P font (Google Fonts)
- Deployed on **Vercel**

### Backend
- **Node.js** with Express.js
- **MongoDB Atlas** - Cloud database for URL storage
- **Redis Cloud** - Caching layer with TTL
- **Base62 Encoding** - Short code generation
- Deployed on **Render**

## 🏗️ Architecture

```
User Request → Vercel (Frontend) → Render (Backend API)
                                        ↓
                              Redis Cache (1hr TTL)
                                        ↓
                              MongoDB Atlas (Persistent)
```

**Short URL Generation:**
1. A counter increments atomically (Redis, falling back to MongoDB if Redis is down)
2. The counter value is scrambled by a modular multiplication that is bijective
   over the code space, so ids stay unique but codes are not sequential and the
   link space cannot be enumerated by incrementing a code
3. The result is encoded to Base62 (`0-9`, `a-z`, `A-Z`), producing codes like `qdzLz`

**Custom Names:**
Pass `customCode` to claim a specific alias instead of a generated one. Names are
3-30 characters of `a-z`, `A-Z`, `0-9`, `-` and `_`, are case-sensitive, and cannot
take a reserved path such as `api` or `health`. If a generated code ever collides
with a claimed name, the insert retries with the next id so neither can clobber the other.

**Accounts and ownership:**
- Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie, so they survive the
  free tier spinning down without any server-side session store
- Passwords use `scrypt` from `node:crypto` - no native build to break on deploy
- The `role` is always re-read from MongoDB, never trusted from the token, so revoking
  admin takes effect on the very next request
- The API is proxied through Vercel (`/api/*` in `vercel.json`) so the cookie is
  first-party; third-party cookies are already blocked by Safari

**Guest expiry:**
- Only links with no owner get an `expiresAt`, and a TTL index deletes them when it passes
- Documents where the field is absent are never touched, so every link created before
  accounts existed is immortal. **`expiresAt` is never backfilled onto old rows.**
- Expiry is approximate (the sweep runs ~every 60s), so the redirect also filters on
  `expiresAt` and the cache clamps its TTL to the link's remaining life

**Resilience:**
- Redis is optional. If `REDIS_URL` is unset, or the instance is deleted or
  unreachable, redirects and shortening keep working from MongoDB alone
- Counters are reseeded past the highest stored id at boot, so a wiped or
  recreated Redis can never hand out an id that is already taken
- Paths that cannot be a short code are rejected before reaching the database

## 📡 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | – | Liveness/readiness of MongoDB and Redis |
| POST | `/api/shorten` | – | Create a short URL, optionally with a custom name (30 per 15 min per IP) |
| GET | `/api/check/:code` | – | Is a custom name available? |
| POST | `/api/auth/register` | – | Create an account |
| POST | `/api/auth/login` | – | Sign in (10 attempts / 15 min) |
| POST | `/api/auth/logout` | – | Sign out |
| GET | `/api/auth/me` | session | The signed-in user |
| GET | `/api/me/urls` | session | Your own links, paginated |
| DELETE | `/api/me/urls/:code` | session | Delete one of your links |
| GET | `/api/admin/urls` | admin | Every link, with filters and search |
| GET | `/api/admin/stats` | admin | Headline counts |
| DELETE | `/api/admin/urls/:code` | admin | Delete any link |
| GET | `/api/admin/bulk-preview` | admin | What a bulk delete would destroy |
| POST | `/api/admin/bulk-delete` | admin | Scoped bulk delete (gated, see below) |
| GET | `/debug/ip` | – | What the server thinks your IP is |
| GET | `/:code` | – | Redirect to original URL |
| GET | `/api/stats/:code` | – | Get URL statistics |
| GET | `/api/urls` | `x-admin-key` | Paginated list of all URLs |

### Example: Shorten a URL

```bash
curl -X POST https://pixel-link-2xiq.onrender.com/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/very/long/url"}'
```

Response:

```json
{
  "shortUrl": "https://pixink.vercel.app/qdzLz",
  "shortCode": "qdzLz",
  "isCustom": false
}
```

### Example: Shorten with a custom name

```bash
curl -X POST https://pixel-link-2xiq.onrender.com/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/promo", "customCode": "summer-sale"}'
```

Returns `409` if the name is taken, `400` if it is invalid or reserved.

### Example: List all URLs (admin)

`ADMIN_KEY` must be set on the server; without it the endpoint returns `503`
rather than exposing data.

```bash
curl https://pixel-link-2xiq.onrender.com/api/urls?page=1&limit=20 \
  -H "x-admin-key: $ADMIN_KEY"
```

## 🚀 Run Locally

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Redis Cloud account (or local Redis) - **optional**, see `REDIS_URL` below

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/NiharKT12/Pixel-Link.git
   cd Pixel-Link
   ```

2. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `MONGO_URI` | yes | MongoDB connection string |
   | `REDIS_URL` | no | Redis connection string. Unset = run without a cache (MongoDB only) |
   | `PORT` | no | API port (default `5000`) |
   | `CACHE_TTL` | no | Redirect cache lifetime in seconds (default `3600`) |
   | `BASE_URL` | no | Public origin short links are built from (default `https://pixink.vercel.app`) |
   | `FRONTEND_URL` | no | Origin allowed by CORS; unset allows any origin (dev only) |
   | `ADMIN_KEY` | no | Break-glass admin secret (`x-admin-key` header); unset keeps it closed |
| `JWT_SECRET` | for auth | Signs session cookies. Unset ⇒ `/api/auth/*` returns 503 |
| `ADMIN_EMAIL` | no | Promotes that registered account to admin at boot |
| `TRUST_PROXY_HOPS` | no | Proxies in front of the app (default `1`; `2` behind the Vercel API proxy) |
| `GUEST_LINK_TTL_DAYS` | no | Guest link lifetime in days. `0` (default) disables expiry |
| `ALLOW_DELETE_ALL` | no | Enables admin bulk delete. Off unless exactly `true` |
| `RATE_LIMIT_*_MAX` | no | Tune a limiter without editing code: `SHORTEN` (30), `AUTH` (10), `REGISTER` (5), `API` (300) |

4. **Start the backend**
   ```bash
   npm start      # or: npm run dev  (restarts on file changes)
   ```

5. **Open the frontend**
   - Open `frontend/index.html` in your browser
   - Or use Live Server extension in VS Code

## 📁 Project Structure

```
Pixel-Link/
├── frontend/
│   ├── index.html        # Main shortener page
│   ├── dashboard.html    # Analytics dashboard
│   ├── app.js            # Shared frontend helpers + session nav
│   ├── login.html        # Sign in / register
│   ├── account.html      # Your links, analytics, delete
│   ├── admin.html        # All links, search, delete, danger zone
│   ├── auth.css          # Auth, list and admin styles
│   ├── style.css         # Main styles
│   ├── dashboard.css     # Dashboard styles
│   └── vercel.json       # Vercel routing config
├── backend/
│   ├── server.js         # Express server & redirect handler
│   ├── routes/
│   │   ├── url.js        # Shorten, check, stats
│   │   ├── auth.js       # Register, login, logout, me
│   │   ├── me.js         # A user's own links
│   │   └── admin.js      # Admin listing, delete, bulk delete
│   ├── models/
│   │   ├── Url.js        # MongoDB schema
│   │   ├── Counter.js    # Durable id counter (Redis fallback)
│   │   └── User.js       # Accounts
│   ├── lib/
│   │   ├── shortcode.js  # Base62 encoding & code validation
│   │   ├── ids.js        # Id allocation and counter syncing
│   │   ├── config.js     # Parsed environment configuration
│   │   ├── cache.js      # Link cache with expiry-clamped TTL
│   │   ├── listLinks.js  # Shared paginated listing
│   │   ├── password.js   # scrypt hashing
│   │   └── tokens.js     # Session JWT + cookie
│   ├── middleware/
│   │   ├── rateLimit.js  # Per-IP rate limiters
│   │   └── auth.js       # attachUser, requireUser, requireAdmin
│   ├── config/
│   │   └── redis.js      # Redis connection
│   ├── package.json
│   ├── .env.example      # Template for environment variables
│   └── .env              # Environment variables (not in repo)
├── .gitignore
├── LICENSE
└── README.md
```

## 🔐 Admin

Register normally, set `ADMIN_EMAIL` to that address, and restart - the account is
promoted at boot. There is deliberately no endpoint that grants admin. `ADMIN_KEY`
remains as break-glass access for curl, and keeps working if `JWT_SECRET` is rotated.

### Bulk delete

Irreversible, with no backup behind it, so it is gated several ways:

- Disabled unless `ALLOW_DELETE_ALL=true`
- Only runs against an explicit scope (`unclaimed`, `expired`, `user`, `all`) - a missing
  or unknown scope is rejected rather than treated as "everything"
- The request must echo back the exact current count (`DELETE 42`), so a stale preview
  cannot fire it
- Requires the admin password again, on top of the session cookie
- Capped at 500 per call, and invalidates each deleted code from the cache

## 🧪 Tests

```bash
cd backend
npm test                    # ~20s
RUN_SLOW_TESTS=1 npm test   # adds the ~60s TTL sweep
```

No local MongoDB or Redis needed - each test file boots the real `server.js`
against an in-memory MongoDB and an in-process Redis. See
[`backend/test/README.md`](backend/test/README.md) for the layout and the
gotchas worth knowing before adding tests.

## 📝 License

[MIT](LICENSE) - feel free to use this project for learning or your own purposes!

---

Made with 💜 and pixels
