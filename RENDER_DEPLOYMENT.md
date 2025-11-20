# Render Deployment Guide

## ⚠️ IMPORTANT: Service Configuration Issue

The webhook URL you provided (`https://api.render.com/deploy/srv-d3sol895pdvs73fp9esg?key=9SjMLJtG7OY`) is pointing to **autorepost-web** service, NOT the TikTok API system.

You need to either:
1. Create a NEW Render service for this TikTok API system
2. OR update the existing service to point to the correct repository

---

## 🚀 Step-by-Step Deployment

### Step 1: Create New Render Service

1. Go to https://dashboard.render.com/
2. Click "New +" → "Web Service"
3. Connect your GitHub account if not already connected
4. Select repository:
   - **Option A**: `rehmanul/r7-tiktok-api-site`
   - **Option B**: `Jkratz01/tiktok-api-site`

### Step 2: Configure Service Settings

Fill in the following:

- **Name**: `social-media-api` (or any name you prefer)
- **Region**: Oregon (or closest to your users)
- **Branch**: `main`
- **Root Directory**: Leave blank
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Plan**: Free (or paid for better performance)

### Step 3: Set Environment Variables

Click "Advanced" and add these environment variables:

#### Required Platform Cookies

```
TIKTOK_COOKIE
```
Paste your full TikTok cookie string from .env.example

```
INSTAGRAM_COOKIE
```
Paste your full Instagram cookie string from .env.example

```
YOUTUBE_COOKIE
```
Paste your full YouTube cookie string from .env.example

```
TWITTER_COOKIE
```
Paste your full Twitter cookie string from .env.example

#### Node Configuration

```
NODE_ENV=production
NODE_VERSION=22.x
```

#### Puppeteer/Chromium Configuration

```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_CACHE_DIR=/tmp/chromium-cache
CHROMIUM_PACK_URL=https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.tar
```

#### Optional Performance Settings

```
CACHE_TTL=180
CACHE_MAX_ENTRIES=100
RATE_LIMIT_REQUESTS_PER_MINUTE=60
RATE_LIMIT_REQUESTS_PER_HOUR=1000
```

### Step 4: Deploy

1. Click "Create Web Service"
2. Wait for the build to complete (5-10 minutes)
3. Check the logs for any errors
4. Once deployed, you'll get a URL like: `https://social-media-api.onrender.com`

### Step 5: Test the Service

Open your browser and test:

1. **Health Check**: `https://your-service.onrender.com/health`
   - Should return JSON with `status: "ok"` and platforms list

2. **Web Interface**: `https://your-service.onrender.com/`
   - Should show the modern UI with 4 platform cards

3. **API Endpoint**: Test with API key "admin" or "darkcampaign"
   ```
   https://your-service.onrender.com/api/tiktok?username=test&page=1&per-page=5&apiKey=admin
   ```

---

## 🔧 Troubleshooting

### Service Shows "Not Found"

- **Cause**: Service is sleeping (free tier) or not running
- **Fix**: Go to Render dashboard → Click on service → Click "Manual Deploy"

### Build Fails

- **Cause**: Missing dependencies or Node version mismatch
- **Fix**: Check build logs, ensure Node 22.x is specified

### "Chromium executable not available"

- **Cause**: Chromium binary not downloading
- **Fix**: Verify `CHROMIUM_PACK_URL` is set correctly and accessible

### API Returns 401 Unauthorized

- **Cause**: Missing or invalid API key
- **Fix**: Use "admin" or "darkcampaign" as API key

### No Data Returned

- **Cause**: Missing platform cookies
- **Fix**: Add TIKTOK_COOKIE, INSTAGRAM_COOKIE, YOUTUBE_COOKIE, TWITTER_COOKIE in environment variables

---

## 📊 Service Monitoring

### Check Service Health

```bash
curl https://your-service.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-20T00:00:00.000Z",
  "uptime": 123.45,
  "version": "1.0.0",
  "platforms": ["tiktok", "instagram", "youtube", "twitter"]
}
```

### View Logs

1. Go to Render Dashboard
2. Click on your service
3. Click "Logs" tab
4. Monitor for errors or warnings

---

## 🔄 Auto-Deploy Setup

### Get Your Deploy Hook

1. Go to Render Dashboard
2. Click on your service
3. Go to "Settings" tab
4. Scroll to "Deploy Hook"
5. Copy the URL (looks like: `https://api.render.com/deploy/srv-XXXXX?key=XXXXX`)

### Trigger Deploy via Webhook

```bash
curl -X GET "https://api.render.com/deploy/srv-XXXXX?key=XXXXX"
```

---

## 🎯 Production Checklist

- [ ] Service created on Render with correct repository
- [ ] All 4 platform cookies added to environment variables
- [ ] Node environment set to production
- [ ] Chromium configuration verified
- [ ] Health endpoint returns 200 OK
- [ ] Web interface loads correctly
- [ ] All 4 platforms (TikTok, Instagram, YouTube, Twitter) tested
- [ ] API keys work correctly (admin, darkcampaign)
- [ ] Export functionality tested
- [ ] Pagination works
- [ ] Error handling displays correctly

---

## 📝 Notes

- **Free Tier**: Service sleeps after 15 minutes of inactivity
- **Cold Start**: First request after sleep takes 30-60 seconds
- **Memory**: 512MB default (increase if needed)
- **Timeout**: 60 seconds per request (set in vercel.json)
- **Regions**: Oregon is recommended for US traffic

---

## 🆘 Support

If issues persist:

1. Check Render service logs for specific error messages
2. Verify all environment variables are set correctly
3. Test locally with `npm start` to isolate Render-specific issues
4. Ensure cookies are valid and not expired
