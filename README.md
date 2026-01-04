# 🎮 Pixel Link

A retro pixel-art themed URL shortener with analytics dashboard.

![Pixel Link](https://img.shields.io/badge/Status-Live-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green) ![Redis](https://img.shields.io/badge/Redis-Cloud-red)

## 🌐 Live Demo

- **Frontend:** [https://pixink.vercel.app](https://pixink.vercel.app)
- **Backend API:** [https://pixel-link-2xiq.onrender.com](https://pixel-link-2xiq.onrender.com)

## ✨ Features

- 🔗 **URL Shortening** - Convert long URLs into short, shareable links
- 📊 **Analytics Dashboard** - Track click counts for your shortened URLs
- ⚡ **Redis Caching** - Fast redirects with 1-hour TTL caching
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
1. Redis counter increments atomically
2. Counter value encoded to Base62 (a-z, A-Z, 0-9)
3. Results in short codes like `a`, `b`, ... `z`, `A`, ... `10`, `11`, etc.

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/shorten` | Create a short URL |
| GET | `/:code` | Redirect to original URL |
| GET | `/api/stats/:code` | Get URL statistics |
| GET | `/api/urls` | List all URLs (admin) |

### Example: Shorten a URL

```bash
curl -X POST https://pixel-link-2xiq.onrender.com/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"originalUrl": "https://example.com/very/long/url"}'
```

Response:
```json
{
  "shortUrl": "https://pixink.vercel.app/a1B",
  "shortCode": "a1B",
  "originalUrl": "https://example.com/very/long/url"
}
```

## 🚀 Run Locally

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Redis Cloud account (or local Redis)

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
   # backend/.env
   MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/pixellink
   REDIS_URL=redis://default:<pass>@<host>:<port>
   PORT=5000
   CACHE_TTL=3600
   ```

4. **Start the backend**
   ```bash
   npm start
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
│   ├── style.css         # Main styles
│   ├── dashboard.css     # Dashboard styles
│   └── vercel.json       # Vercel routing config
├── backend/
│   ├── server.js         # Express server & redirect handler
│   ├── routes/
│   │   └── url.js        # API routes
│   ├── models/
│   │   └── Url.js        # MongoDB schema
│   ├── config/
│   │   └── redis.js      # Redis connection
│   ├── package.json
│   └── .env              # Environment variables (not in repo)
├── .gitignore
└── README.md
```

## 📝 License

MIT License - feel free to use this project for learning or your own purposes!

---

Made with 💜 and pixels
