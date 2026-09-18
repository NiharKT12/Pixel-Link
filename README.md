# 🎮 Pixel Link

A retro pixel-art themed URL shortener with analytics dashboard.

![Pixel Link](https://img.shields.io/badge/Status-Live-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green) ![Redis](https://img.shields.io/badge/Redis-Cloud-red) ![License](https://img.shields.io/badge/License-MIT-blue)

## 🌐 Live Demo

- **Frontend:** [https://pixink.vercel.app](https://pixink.vercel.app)
- **Backend API:** [https://pixel-link-2xiq.onrender.com](https://pixel-link-2xiq.onrender.com)

## ✨ Features

- 🔗 **URL Shortening** - Convert long URLs into short, shareable links
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
| POST | `/api/shorten` | – | Create a short URL (30 per 15 min per IP) |
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
  "shortCode": "qdzLz"
}
```

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
   | `BASE_URL` | no | Public origin short links are built from (default `http://localhost:$PORT`) |
   | `FRONTEND_URL` | no | Origin allowed by CORS; unset allows any origin (dev only) |
   | `ADMIN_KEY` | no | Shared secret for `GET /api/urls`; unset keeps it closed |

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
│   ├── app.js            # Shared frontend helpers
│   ├── style.css         # Main styles
│   ├── dashboard.css     # Dashboard styles
│   └── vercel.json       # Vercel routing config
├── backend/
│   ├── server.js         # Express server & redirect handler
│   ├── routes/
│   │   └── url.js        # API routes
│   ├── models/
│   │   ├── Url.js        # MongoDB schema
│   │   └── Counter.js    # Durable id counter (Redis fallback)
│   ├── lib/
│   │   ├── shortcode.js  # Base62 encoding & code validation
│   │   ├── ids.js        # Id allocation and counter syncing
│   │   └── config.js     # Parsed environment configuration
│   ├── middleware/
│   │   └── rateLimit.js  # Per-IP rate limiters
│   ├── config/
│   │   └── redis.js      # Redis connection
│   ├── package.json
│   ├── .env.example      # Template for environment variables
│   └── .env              # Environment variables (not in repo)
├── .gitignore
├── LICENSE
└── README.md
```

## 📝 License

[MIT](LICENSE) - feel free to use this project for learning or your own purposes!

---

Made with 💜 and pixels
