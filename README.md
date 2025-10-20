# TikTok API System

A production-ready Node.js API for retrieving TikTok posts by username. The service runs on Node 22, uses real Chromium automation via `puppeteer-core` + `@sparticuz/chromium`, and ships with configurable rate limiting, server-side caching, and first-class Docker/Vercel support.

## Highlights

- Headless Chromium scraping with robust DOM/API parsing (no mocked data or placeholders)
- Fast-path HTTP scraping that avoids launching Chromium when TikTok responds cleanly
- Configurable rate limiting (per-minute and per-hour windows) surfaced via response headers
- In-memory response cache with TTL and bounded size
- Time range filtering (`start_epoch` / `end_epoch`) and pagination (`page`, `per-page`)
- Secure cookie handling through the `X-TikTok-Cookie` header or environment variables
- Express server with Helmet, compression, structured logging, and a bundled web UI for manual testing
- Works on Vercel’s `nodejs22.x` runtime and ships with a hardened Dockerfile + Compose stack

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 22.x |
| npm | 10.x (bundled with Node 22) |
| Optional | Docker 24+ with Compose V2 |

## Quick Start (Node)

```bash
npm ci
cp env.production.example .env.production    # fill in values
npm start                                    # http://localhost:3000
```

Visit `http://localhost:3000/` for the bundled dashboard or query the API directly at `http://localhost:3000/api/tiktok`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TIKTOK_COOKIE` | Full TikTok cookie string or JSON array encoded as text | empty |
| `TIKTOK_SESSION_ID` | Fallback session cookie if `TIKTOK_COOKIE` is empty | empty |
| `TIKTOK_WEBID` | Fallback `tt_webid` cookie if `TIKTOK_COOKIE` is empty | empty |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Requests allowed in a rolling minute (set `0` to disable) | `60` |
| `RATE_LIMIT_REQUESTS_PER_HOUR` | Requests allowed per hour (set `0` to disable) | `1000` |
| `CACHE_TTL` | Cache lifetime in seconds (set `0` to disable caching) | `120` |
| `CACHE_MAX_ENTRIES` | Max cached responses stored in memory | `100` |
| `NAVIGATION_TIMEOUT_MS` | Puppeteer navigation timeout | `30000` |
| `CONTENT_WAIT_MS` | Wait after load before scraping | `5000` |
| `HTTP_FETCH_TIMEOUT_MS` | Timeout (ms) for direct HTTP requests to TikTok | `12000` |
| `HTTP_MAX_RETRIES` | Retries for direct HTTP requests before failing over | `3` |
| `TIKTOK_ITEM_LIST_PAGE_SIZE` | Items requested per TikTok API page (max `35`) | `30` |
| `TIKTOK_ITEM_LIST_MAX_PAGES` | Maximum HTTP pages fetched before stopping | `40` |
| `TIKTOK_ITEM_LIST_BUFFER_PAGES` | Extra HTTP pages fetched beyond the requested window | `2` |
| `PORT` | HTTP port used in local/Docker setups | `3000` |

Cookies can be supplied per request with the `X-TikTok-Cookie` header (base64 encoded string or JSON cookie array). Environment values act as defaults when the header is omitted.

## Running with Docker

```bash
cp env.production.example .env.production    # configure values
docker compose --env-file .env.production up -d
# API → http://localhost:3000, UI → http://localhost:3000/
```

The Dockerfile installs all Chromium runtime dependencies, runs the app as a non-root user, and exposes a health check at `/health`.

## API Reference

**Endpoint**
```
GET /api/tiktok
```

**Query Parameters**
| Name | Required | Description |
|------|----------|-------------|
| `username` | ✅ | TikTok username without `@` |
| `page` | ❌ | 1-based page index (default `1`) |
| `per-page` | ❌ | Page size (`1`–`100`, default `10`) |
| `start_epoch` | ❌ | Return posts created at or after this Unix timestamp |
| `end_epoch` | ❌ | Return posts created at or before this Unix timestamp |

**Headers**
- `X-TikTok-Cookie` (optional): Base64 encoded cookie string or JSON array; overrides env values for the request.
- Response headers expose rate limiting and cache metadata:
  - `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`, `X-RateLimit-Reset-Minute`
  - `X-RateLimit-Limit-Hour`, `X-RateLimit-Remaining-Hour`, `X-RateLimit-Reset-Hour`
  - `X-Cache` (`MISS`, `HIT`, or `DISABLED`) and `X-Cache-Expires-In`

**Example**
```bash
curl "http://localhost:3000/api/tiktok?username=tiktok&per-page=5" \
  -H "Accept: application/json"
```

**Sample Response**
```json
{
  "meta": {
    "username": "tiktok",
    "page": 1,
    "total_pages": 24,
    "posts_per_page": 5,
    "total_posts": 120,
    "profile_total_posts": 120,
    "fetched_posts": 120,
    "start_epoch": null,
    "end_epoch": null,
    "first_video_epoch": 1729446293,
    "last_video_epoch": 1727010241,
    "request_time": 1729621200,
    "cache_status": "MISS",
    "fetch_method": "http",
    "fetch_iterations": 4
  },
  "data": [
    {
      "video_id": "7423567890123456789",
      "url": "https://www.tiktok.com/@tiktok/video/7423567890123456789",
      "description": "Launching something new 👀",
      "epoch_time_posted": 1729446293,
      "views": 5320101,
      "likes": 823411,
      "comments": 17920,
      "shares": 42013
    }
  ],
  "status": "success"
}
```
Fields without TikTok data are returned as `null` rather than synthetic defaults.

The `meta` object now surfaces additional telemetry:
- `profile_total_posts`: TikTok’s reported post count (from the profile header).
- `fetched_posts`: Number of posts gathered during the request (after de-duplication).
- `fetch_method`: `http` when the lightweight fetch path succeeds, or `browser` when Chromium was required.
- `fetch_iterations`: How many paginated HTTP calls were needed (useful when tuning limits).
- `http_fallback_reason`: Present only when the handler had to fall back to Chromium after a failed HTTP attempt.

## Rate Limiting & Caching

- Rate limits are enforced per client IP across minute/hour windows. Setting an environment variable to `0` disables that window.
- The in-memory cache stores up to `CACHE_MAX_ENTRIES` responses per unique `(username, pagination, epoch filters, cookie)` tuple. TTL is controlled via `CACHE_TTL`. Set to `0` to disable caching entirely.

## Local Dashboard

`public/index.html` (served at `/`) provides a polished UI for testing:
- Username search with pagination and optional date filters
- Client-side caching to prevent redundant requests
- Displays server cache status, rate limit headers, and response times

## Deployment (Vercel)

- Runtime: `nodejs22.x` (configured in `vercel.json`)
- Build command: `npm ci`
- Memory: `2048` MB (Hobby plan maximum; upgrade to Vercel Pro or Teams to raise it)
- Ensure `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` is set (already in `vercel.json`)
- Configure environment variables in the Vercel dashboard identical to `.env.production`
- Deploy via Git integration or `vercel --prod`

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `Chromium executable path not available` | Missing system dependencies or incompatible runtime | Deploy on Node 22 / use provided Dockerfile |
| `Rate limit exceeded` (429) | Client exceeded configured limits | Inspect `X-RateLimit-*` headers and adjust env values |
| Empty `data` array | Private account or missing cookies | Provide valid TikTok cookies via env or request header |
| Vercel build warns about Node 22 | Keep `package.json` and `vercel.json` set to Node 22 (Hobby plan requirement) |

## License

MIT License. See `LICENSE` for details.
