# TikTok API - Node.js Implementation

A production-ready serverless API that retrieves TikTok post details based on username with time-based filtering capabilities. Built with Node.js, Playwright, and Vercel.

## Features

- ✅ **Serverless Architecture**: Deployed on Vercel with automatic scaling
- ✅ **Browser Automation**: Uses Playwright with Chromium for reliable data extraction
- ✅ **Cookie Authentication**: Supports TikTok session cookies for authenticated requests
- ✅ **Pagination & Filtering**: Time-based filtering with pagination support
- ✅ **Rate Limiting**: Built-in rate limiting to prevent abuse
- ✅ **CORS Support**: Cross-origin requests enabled
- ✅ **Error Handling**: Comprehensive error handling with meaningful messages

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables
Create a `.env.local` file or set in Vercel dashboard:
```bash
TIKTOK_COOKIES=[{"domain":".tiktok.com","name":"sessionid","value":"your_session_id",...}]
```

### 3. Run Locally
```bash
npm run dev
```

### 4. Deploy to Vercel
```bash
npm run deploy
```

## API Usage

### Endpoint
```
GET https://your-project.vercel.app/api/tiktok
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `username` | string | ✅ Yes | - | TikTok username to scrape |
| `page` | integer | ❌ No | 1 | Page number for pagination |
| `per-page` | integer | ❌ No | 10 | Posts per page (max: 100) |
| `start_epoch` | integer | ❌ No | - | Unix timestamp filter start |
| `end_epoch` | integer | ❌ No | - | Unix timestamp filter end |

### Headers
```
X-TikTok-Cookie: [JSON cookie array or cookie string] (optional)
```

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

### Response Format

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

## Configuration

### Environment Variables
- `TIKTOK_COOKIES`: JSON array of TikTok cookies (required for production)

### Vercel Configuration
The `vercel.json` includes:
- Memory allocation: 3008 MB
- Max duration: 60 seconds
- Node.js runtime

## Security Considerations

1. **Never commit cookies** to version control
2. **Use environment variables** for production cookies
3. **Implement rate limiting** (built-in)
4. **Monitor Vercel logs** for suspicious activity
5. **Rotate cookies regularly**

## Troubleshooting

### Common Issues

**"Browser launch failed"**
- Increase memory in `vercel.json`
- Check Vercel function logs

**"User not found"**
- Verify username is correct
- Check if profile is private
- Ensure cookies are valid

**"Timeout"**
- Increase `maxDuration` in `vercel.json`
- Optimize scraping logic

**"Invalid response"**
- TikTok may have changed their structure
- Update parsing logic in `api/tiktok.js`

## Performance

| Metric | Value |
|--------|-------|
| Cold start | 10-20 seconds |
| Warm request | 5-10 seconds |
| Memory usage | 1.5-2.5 GB |
| Max duration | 60 seconds |
| Concurrent requests | Unlimited |

## Architecture

```
Client Request → Vercel Edge Network → Serverless Function →
Playwright Browser → TikTok Website → Data Extraction →
Filtering & Pagination → JSON Response
```

## Dependencies

- `@sparticuz/chromium`: Chromium binary for serverless environments
- `playwright-core`: Browser automation framework
- `vercel`: Deployment platform

## License

MIT License - see LICENSE file for details.
