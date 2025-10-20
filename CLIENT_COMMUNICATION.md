# TikTok API - Client Communication

## 🎉 Your TikTok API is Ready!

Dear Client,

Your TikTok API is now **fully deployed and operational** on Vercel. Here's everything you need to know:

---

## 📍 API Endpoint

**Production URL:** `https://tiktok-api-system-dhc3rmu7f-dataprocessor.vercel.app`

---

## 🚀 How It Works

The API scrapes TikTok user profile data and returns comprehensive video information including:
- Video URLs and IDs
- Descriptions
- Engagement metrics (views, likes, comments, shares)
- Timestamps (epoch time)
- Pagination support
- Date range filtering

---

## 📖 API Usage

### Basic Request

```bash
GET /api/tiktok?username=khaby.lame
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | ✅ Yes | TikTok username (without @) |
| `page` | integer | No | Page number (default: 1) |
| `per-page` | integer | No | Results per page (default: 10, max: 100) |
| `start_epoch` | integer | No | Filter videos after this timestamp |
| `end_epoch` | integer | No | Filter videos before this timestamp |

### Example Requests

**Get first 10 videos:**
```
GET /api/tiktok?username=khaby.lame
```

**Get page 2 with 20 videos per page:**
```
GET /api/tiktok?username=khaby.lame&page=2&per-page=20
```

**Get videos from a specific date range:**
```
GET /api/tiktok?username=khaby.lame&start_epoch=1640000000&end_epoch=1650000000
```

---

## 📊 Response Format

```json
{
  "meta": {
    "page": 1,
    "total_pages": 5,
    "posts_per_page": 10,
    "total_posts": 50,
    "start_epoch": null,
    "end_epoch": null,
    "first_video_epoch": 1729280778,
    "last_video_epoch": 1720000000,
    "request_time": 1729280778,
    "username": "khaby.lame"
  },
  "data": [
    {
      "video_id": "7234567890123456789",
      "url": "https://www.tiktok.com/@khaby.lame/video/7234567890123456789",
      "description": "Video description here",
      "epoch_time_posted": 1729280778,
      "views": 1500000,
      "likes": 250000,
      "comments": 5000,
      "shares": 3000
    }
  ],
  "status": "success"
}
```

---

## 🔐 Authentication

The API uses **TikTok session cookies** for authentication. These cookies are:
- Pre-configured in the deployment
- Need to be refreshed periodically (every 30-90 days)
- Located in `api/tiktok.js` file

**To update cookies when they expire:**
1. Log in to TikTok in your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage > Cookies
4. Copy the `sessionid` and `msToken` values
5. Update them in the `api/tiktok.js` file
6. Redeploy to Vercel

---

## ⚙️ Technical Specifications

- **Hosting**: Vercel Serverless Functions
- **Memory**: 2048MB (Hobby plan limit)
- **Timeout**: 60 seconds per request
- **Browser**: Puppeteer with Chromium (optimized for serverless)
- **Runtime**: Node.js 22.x
- **Framework**: Express.js (local testing)

---

## 🔄 Deployment Status

✅ **Successfully Deployed**
- Production URL: https://tiktok-api-system-dhc3rmu7f-dataprocessor.vercel.app
- Memory optimized for Vercel Hobby plan
- Browser configuration optimized for serverless environment
- Shared library issues resolved

---

## 🛡️ Vercel Protection

Your deployment has **Vercel authentication protection** enabled. To access it:

**Option 1: Browser Access**
- Simply visit the URL in your browser
- You'll be redirected to authenticate with Vercel
- After authentication, you can use the API normally

**Option 2: Programmatic Access**
- Use your Vercel bypass token in requests
- Add `?x-vercel-protection-bypass=YOUR_TOKEN` to API calls
- Get your token from Vercel dashboard: Settings > Deployment Protection

---

## 📝 Example Integration

### JavaScript/Node.js
```javascript
const fetch = require('node-fetch');

async function getTikTokVideos(username) {
  const response = await fetch(
    `https://tiktok-api-system-dhc3rmu7f-dataprocessor.vercel.app/api/tiktok?username=${username}`
  );
  const data = await response.json();
  return data;
}

// Usage
getTikTokVideos('khaby.lame').then(data => {
  console.log(data);
});
```

### Python
```python
import requests

def get_tiktok_videos(username):
    url = f"https://tiktok-api-system-dhc3rmu7f-dataprocessor.vercel.app/api/tiktok"
    params = {'username': username}
    response = requests.get(url, params=params)
    return response.json()

# Usage
data = get_tiktok_videos('khaby.lame')
print(data)
```

### cURL
```bash
curl "https://tiktok-api-system-dhc3rmu7f-dataprocessor.vercel.app/api/tiktok?username=khaby.lame"
```

---

## ⚠️ Important Notes

1. **Rate Limiting**: TikTok may rate-limit requests. Implement delays between calls if making many requests.

2. **Cookie Expiration**: TikTok session cookies expire periodically. You'll need to refresh them when they do.

3. **Response Times**: First request may take 10-20 seconds as the browser initializes. Subsequent requests are faster.

4. **Error Handling**: Always check the `status` field in responses. Errors return `status: "error"` with error details.

5. **Memory Limits**: The API is optimized for Vercel's 2048MB memory limit. Very large responses may occasionally timeout.

---

## 🐛 Troubleshooting

### "Authentication Required" Error
- This is normal Vercel protection behavior
- Access the URL in a browser first to authenticate
- Or use your Vercel bypass token

### "Missing required parameter: username" Error
- Ensure you're including the `username` parameter
- Example: `?username=khaby.lame`

### Timeout Errors
- Some profiles with many videos may timeout
- Try reducing `per-page` value
- Use date range filtering to limit results

### Empty Data Response
- Check if the username is correct
- Verify TikTok cookies are still valid
- The user may have a private profile

---

## 📞 Support

For technical issues or questions:
- Check the deployment logs in Vercel dashboard
- Verify cookies are up to date
- Contact your developer for API modifications

---

## ✅ Next Steps

1. **Test the API**: Try making requests to verify functionality
2. **Integrate**: Use the examples above to integrate into your application
3. **Monitor**: Keep an eye on Vercel dashboard for usage and errors
4. **Maintain**: Refresh TikTok cookies when they expire

Your API is production-ready and optimized for performance! 🚀
