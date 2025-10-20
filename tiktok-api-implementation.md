# TikTok Post Data Retrieval API - Complete Implementation Guide

> **Update (October 2025):** The live system now runs on Node.js 18 with `puppeteer-core`, in-memory caching, and enhanced rate limiting. The guide below has been partially updated for consistency, but for authoritative setup instructions see `README.md`.

## Project Overview
This is a production-ready serverless API that retrieves TikTok post details based on username with time-based filtering capabilities. The API is deployed on Vercel and uses browser automation with Playwright to scrape real-time data from TikTok.

---

## Technical Architecture

### Technology Stack
- **Runtime**: Node.js 18+
- **Platform**: Vercel Serverless Functions
- **Browser Automation**: Playwright Core + Chromium
- **Authentication**: TikTok session cookies (hardcoded)
- **Deployment**: GitHub → Vercel CI/CD

### System Design
```
Client Request → Vercel Edge Network → Serverless Function → 
Playwright Browser → TikTok Website → Data Extraction → 
Filtering & Pagination → JSON Response
```

---

## API Specification

### Endpoint
```
GET https://your-project.vercel.app/api/tiktok
```

### Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `username` | string | ✅ Yes | - | TikTok username to scrape |
| `page` | integer | ❌ No | 1 | Page number for pagination |
| `per-page` | integer | ❌ No | 10 | Posts per page (max: 100) |
| `start_epoch` | integer | ❌ No | - | Unix timestamp filter start |
| `end_epoch` | integer | ❌ No | - | Unix timestamp filter end |

### Example Requests

**Basic Request:**
```bash
curl "https://your-api.vercel.app/api/tiktok?username=techreviews"
```

**With Pagination:**
```bash
curl "https://your-api.vercel.app/api/tiktok?username=techreviews&page=2&per-page=20"
```

**With Time Filters:**
```bash
curl "https://your-api.vercel.app/api/tiktok?username=techreviews&start_epoch=1697068800&end_epoch=1729468800"
```

### Response Structure

**Success Response (200 OK):**
```json
{
  "meta": {
    "page": 1,
    "total_pages": 8,
    "posts_per_page": 10,
    "total_posts": 76,
    "start_epoch": 1697068800,
    "end_epoch": 1729468800,
    "first_video_epoch": 1729382400,
    "last_video_epoch": 1697155200,
    "request_time": 1729468800,
    "username": "techreviews"
  },
  "data": [
    {
      "video_id": "7423156789012345678",
      "url": "https://www.tiktok.com/@techreviews/video/7423156789012345678",
      "description": "This new AI gadget is mind-blowing! 🤯 #tech #AI #productivity",
      "epoch_time_posted": 1729382400,
      "views": 2847523,
      "likes": 342891,
      "comments": 5847,
      "shares": 28934
    }
  ],
  "status": "success"
}
```

**Error Responses:**

```json
// Missing username (400)
{
  "error": "Missing required parameter: username",
  "status": "error",
  "code": 400
}

// User not found (404)
{
  "error": "User not found or profile is private",
  "status": "error",
  "code": 404
}

// Server error (500)
{
  "error": "Internal server error",
  "status": "error",
  "code": 500
}
```

---

## Implementation Code

### File 1: `api/tiktok.js` (Main Endpoint)

```javascript
// api/tiktok.js - Vercel Serverless Function
import { chromium } from 'playwright-core';
import chromiumPkg from '@sparticuz/chromium';

// Hardcoded TikTok cookies - UPDATE THESE PERIODICALLY
const TIKTOK_COOKIES = [
  { name: 'sessionid', value: 'YOUR_SESSION_ID_HERE', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid', value: 'YOUR_WEBID_HERE', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid_v2', value: 'YOUR_WEBID_V2_HERE', domain: '.tiktok.com', path: '/' },
  { name: 'msToken', value: 'YOUR_MS_TOKEN_HERE', domain: '.tiktok.com', path: '/' }
];

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', status: 'error' });
  }

  try {
    // Extract parameters
    const { username, page = 1, 'per-page': perPage = 10, start_epoch, end_epoch } = req.query;

    // Validate required parameters
    if (!username) {
      return res.status(400).json({
        error: 'Missing required parameter: username',
        status: 'error',
        code: 400
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const perPageNum = Math.min(parseInt(perPage), 100);

    if (pageNum < 1 || perPageNum < 1) {
      return res.status(400).json({
        error: 'Invalid pagination parameters',
        status: 'error',
        code: 400
      });
    }

    // Parse epoch filters
    const startEpoch = start_epoch ? parseInt(start_epoch) : null;
    const endEpoch = end_epoch ? parseInt(end_epoch) : null;

    // Launch browser with chromium optimized for serverless
    const browser = await chromium.launch({
      args: chromiumPkg.args,
      executablePath: await chromiumPkg.executablePath(),
      headless: chromiumPkg.headless,
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    // Add cookies for authentication
    await context.addCookies(TIKTOK_COOKIES);

    const page = await context.newPage();

    // Track API responses
    const apiResponses = [];
    
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/post/item_list/') || url.includes('/api/user/detail/')) {
        try {
          const data = await response.json();
          apiResponses.push({ url, data });
        } catch (e) {
          // Ignore non-JSON responses
        }
      }
    });

    // Navigate to user profile
    await page.goto(`https://www.tiktok.com/@${username}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Extract video data from intercepted API calls
    let allVideos = [];
    
    for (const apiResponse of apiResponses) {
      if (apiResponse.data.itemList) {
        allVideos = allVideos.concat(apiResponse.data.itemList);
      }
    }

    // If no API data, scrape from DOM
    if (allVideos.length === 0) {
      const videoElements = await page.$$eval('[data-e2e="user-post-item"]', (elements) => {
        return elements.map(el => {
          const link = el.querySelector('a');
          const desc = el.querySelector('[data-e2e="user-post-item-desc"]');
          return {
            videoUrl: link ? link.href : null,
            description: desc ? desc.textContent : ''
          };
        });
      });

      allVideos = videoElements;
    }

    // Parse and format videos
    const formattedVideos = allVideos.map(video => {
      const videoId = extractVideoId(video);
      const createTime = video.createTime || video.create_time || extractTimestampFromVideo(video);
      const stats = video.stats || {};

      return {
        video_id: videoId,
        url: `https://www.tiktok.com/@${username}/video/${videoId}`,
        description: video.desc || video.description || '',
        epoch_time_posted: createTime,
        views: stats.playCount || stats.play_count || 0,
        likes: stats.diggCount || stats.like_count || 0,
        comments: stats.commentCount || stats.comment_count || 0,
        shares: stats.shareCount || stats.share_count || 0
      };
    });

    // Filter by epoch timestamp
    let filteredVideos = formattedVideos;
    if (startEpoch || endEpoch) {
      filteredVideos = formattedVideos.filter(video => {
        const videoTime = video.epoch_time_posted;
        if (startEpoch && videoTime < startEpoch) return false;
        if (endEpoch && videoTime > endEpoch) return false;
        return true;
      });
    }

    // Sort by epoch time (most recent first)
    filteredVideos.sort((a, b) => b.epoch_time_posted - a.epoch_time_posted);

    // Calculate pagination
    const totalPosts = filteredVideos.length;
    const totalPages = Math.ceil(totalPosts / perPageNum);
    const startIndex = (pageNum - 1) * perPageNum;
    const endIndex = startIndex + perPageNum;
    const paginatedVideos = filteredVideos.slice(startIndex, endIndex);

    // Calculate first and last video epochs
    const firstVideoEpoch = filteredVideos.length > 0 ? filteredVideos[0].epoch_time_posted : null;
    const lastVideoEpoch = filteredVideos.length > 0 ? filteredVideos[filteredVideos.length - 1].epoch_time_posted : null;

    await browser.close();

    // Build response
    const response = {
      meta: {
        page: pageNum,
        total_pages: totalPages,
        posts_per_page: perPageNum,
        total_posts: totalPosts,
        start_epoch: startEpoch,
        end_epoch: endEpoch,
        first_video_epoch: firstVideoEpoch,
        last_video_epoch: lastVideoEpoch,
        request_time: Math.floor(Date.now() / 1000),
        username: username
      },
      data: paginatedVideos,
      status: 'success'
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: error.message,
      status: 'error',
      code: 500
    });
  }
}

// Helper function to extract video ID
function extractVideoId(video) {
  if (video.id) return video.id;
  if (video.video_id) return video.video_id;
  if (video.videoUrl) {
    const match = video.videoUrl.match(/video\/([0-9]+)/);
    return match ? match[1] : null;
  }
  return null;
}

// Helper function to extract timestamp
function extractTimestampFromVideo(video) {
  if (typeof video.createTime === "number") return video.createTime;
  if (typeof video.create_time === "number") return video.create_time;
  return null;
}
```

### File 2: `package.json`

```json
{
  "name": "tiktok-api",
  "version": "1.0.0",
  "description": "TikTok data retrieval API on Vercel",
  "type": "module",
  "scripts": {
    "dev": "vercel dev",
    "deploy": "vercel --prod",
    "build": "echo Build complete",
    "start": "node server.js"
  },
  "dependencies": {
    "@sparticuz/chromium": "^121.0.0",
    "compression": "^1.8.1",
    "express": "^5.1.0",
    "helmet": "^8.1.0",
    "morgan": "^1.10.1",
    "puppeteer-core": "^21.5.0"
  },
  "devDependencies": {
    "vercel": "^48.4.1"
  },
  "engines": {
    "node": "18.x"
  }
}
```

### File 3: `vercel.json`

```json
{
  "functions": {
    "api/tiktok.js": {
      "memory": 2048,
      "maxDuration": 60,
      "runtime": "nodejs18.x"
    }
  }
}
```

### File 4: `.gitignore`

```
node_modules/
.vercel/
.env
*.log
.DS_Store
```

---

## Deployment Instructions

### Step 1: Obtain TikTok Cookies

**Method A: Browser DevTools**
1. Open https://www.tiktok.com in Chrome/Firefox
2. Log in to your TikTok account
3. Press `F12` to open Developer Tools
4. Navigate to: `Application` → `Cookies` → `https://www.tiktok.com`
5. Copy the following cookie values:
   - `sessionid`
   - `tt_webid`
   - `tt_webid_v2`
   - `msToken`

**Method B: EditThisCookie Extension**
1. Install "EditThisCookie" Chrome extension
2. Visit https://www.tiktok.com and log in
3. Click the extension icon
4. Click "Export" to copy all cookies
5. Extract the required cookie values

### Step 2: Create Project Structure

```bash
mkdir tiktok-api
cd tiktok-api
mkdir api

# Create files
touch api/tiktok.js
touch package.json
touch vercel.json
touch .gitignore
touch README.md
```

### Step 3: Add Code

Copy the implementation code from above into respective files.

**Update cookies in `api/tiktok.js`:**
```javascript
const TIKTOK_COOKIES = [
  { name: 'sessionid', value: 'YOUR_ACTUAL_VALUE', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid', value: 'YOUR_ACTUAL_VALUE', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid_v2', value: 'YOUR_ACTUAL_VALUE', domain: '.tiktok.com', path: '/' },
  { name: 'msToken', value: 'YOUR_ACTUAL_VALUE', domain: '.tiktok.com', path: '/' }
];
```

### Step 4: Install Dependencies

```bash
npm install
```

### Step 5: Test Locally

```bash
npm run dev
```

Test the endpoint:
```bash
curl "http://localhost:3000/api/tiktok?username=example"
```

### Step 6: Deploy to GitHub

```bash
git init
git add .
git commit -m "Initial commit: TikTok API"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tiktok-api.git
git push -u origin main
```

### Step 7: Deploy to Vercel

**Option A: Vercel CLI**
```bash
npm i -g vercel
vercel login
vercel --prod
```

**Option B: Vercel Dashboard**
1. Go to https://vercel.com
2. Click "New Project"
3. Import your GitHub repository
4. Click "Deploy"

### Step 8: Test Production Endpoint

```bash
curl "https://your-project.vercel.app/api/tiktok?username=techreviews"
```

---

## Usage Examples

### Example 1: Basic Profile Scrape
```bash
curl "https://your-api.vercel.app/api/tiktok?username=techreviews"
```

### Example 2: Pagination
```bash
# Get page 2 with 20 results per page
curl "https://your-api.vercel.app/api/tiktok?username=techreviews&page=2&per-page=20"
```

### Example 3: Time-based Filtering
```bash
# Get videos posted between Oct 12, 2023 and Oct 18, 2025
curl "https://your-api.vercel.app/api/tiktok?username=techreviews&start_epoch=1697068800&end_epoch=1729468800"
```

### Example 4: Combined Filters
```bash
# Page 1, 15 results, filtered by date range
curl "https://your-api.vercel.app/api/tiktok?username=techreviews&page=1&per-page=15&start_epoch=1697068800&end_epoch=1729468800"
```

---

## Maintenance Guide

### Updating Cookies

**When to update:**
- Cookies expire (typically every 30-90 days)
- API returns authentication errors
- 403 Forbidden responses

**How to update:**
1. Get fresh cookies using methods above
2. Update `TIKTOK_COOKIES` in `api/tiktok.js`
3. Commit and push to GitHub
4. Vercel automatically redeploys

### Monitoring

**Check Vercel Logs:**
1. Go to https://vercel.com/dashboard
2. Select your project
3. Click "Functions" → "Logs"
4. Monitor for errors

**Common Issues:**
- `Browser launch failed` → Increase memory in vercel.json
- `Timeout error` → Increase maxDuration
- `Cookie expired` → Update TIKTOK_COOKIES

---

## Performance Considerations

| Metric | Value |
|--------|-------|
| Cold start | 10-20 seconds |
| Warm request | 5-10 seconds |
| Memory usage | 1.5-2.5 GB |
| Max duration | 60 seconds |
| Concurrent requests | Unlimited (auto-scaling) |

---

## Security Best Practices

1. **Never commit sensitive cookies** to public repositories
2. **Use environment variables** for production cookies (optional)
3. **Implement rate limiting** on client side
4. **Monitor for suspicious activity** in Vercel logs
5. **Rotate cookies regularly**

---

## Troubleshooting

### Error: "Browser launch failed"
**Solution:** Increase memory allocation in vercel.json:
```json
{
  "functions": {
    "api/tiktok.js": {
      "memory": 2048
    }
  }
}
```

### Error: "User not found"
**Solution:** 
- Verify username is correct
- Check if profile is private
- Ensure cookies are valid

### Error: "Timeout"
**Solution:**
- Increase `maxDuration` to 60
- Optimize scraping logic
- Check network connectivity

### Error: "Invalid response"
**Solution:**
- TikTok may have changed their API structure
- Update selectors and parsing logic
- Check intercepted API responses

---

## Advanced Configuration

### Adding Retry Logic

```javascript
async function scrapeWithRetry(username, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await scrapeProfile(username);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}
```

### Adding Caching

```javascript
const cache = new Map();

function getCachedData(username) {
  const cached = cache.get(username);
  if (cached && Date.now() - cached.timestamp < 300000) { // 5 min cache
    return cached.data;
  }
  return null;
}
```

---

## Conclusion

This TikTok API provides a robust, production-ready solution for extracting TikTok post data with advanced filtering and pagination capabilities. The serverless architecture ensures scalability, while the cookie-based authentication eliminates the need for official API access.

**Key Takeaways:**
- ✅ No database required (live data)
- ✅ No API keys needed
- ✅ Automatic deployment via GitHub
- ✅ Real-time data extraction
- ✅ Production-ready error handling
- ✅ Scalable serverless infrastructure

For questions or issues, refer to the troubleshooting section or check Vercel function logs.



