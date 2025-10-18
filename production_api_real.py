"""
PRODUCTION TIKTOK API - ENTERPRISE GRADE
Cookie-based TikTok fetch using user-supplied cookies
"""

import asyncio
import hashlib
import logging
import time
import asyncio
import hashlib
import logging
import time
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from collections import defaultdict
import json

from fastapi import FastAPI, Query, HTTPException, Header, Request, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, validator
import httpx
# Minimal logging to stdout at import time. File handler is added at startup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


# ============= CONFIGURATION =============

class ProductionConfig:
    """Production configuration (values can be overridden by environment variables)"""

    # API Information
    API_VERSION = os.getenv("API_VERSION", "2.0.0")
    API_TITLE = os.getenv("API_TITLE", "TikTok Data API - Production")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

    # TikTok cookie client (optional global cookie)
    # If provided, will be used as default. Per-request cookies are supported via X-TikTok-Cookie header.
    TIKTOK_COOKIE = os.getenv("TIKTOK_COOKIE")

    # Redis Cache Configuration
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_DB = int(os.getenv("REDIS_DB", "0"))
    REDIS_PASSWORD = os.getenv("REDIS_PASSWORD") or None
    CACHE_TTL = int(os.getenv("CACHE_TTL", "300"))  # 5 minutes

    # Rate Limiting
    RATE_LIMIT_REQUESTS_PER_MINUTE = int(os.getenv("RATE_LIMIT_REQUESTS_PER_MINUTE", "100"))
    RATE_LIMIT_REQUESTS_PER_HOUR = int(os.getenv("RATE_LIMIT_REQUESTS_PER_HOUR", "5000"))
    RATE_LIMIT_BURST = int(os.getenv("RATE_LIMIT_BURST", "20"))

    # Performance
    MAX_CONCURRENT_REQUESTS = int(os.getenv("MAX_CONCURRENT_REQUESTS", "10"))
    REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "60"))
    # Retry/backoff
    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
    BACKOFF_BASE = float(os.getenv("BACKOFF_BASE", "0.5"))

    # Throttling & proxies
    THROTTLE_DELAY = float(os.getenv("THROTTLE_DELAY", "0.2"))
    PROXIES = os.getenv("PROXIES")  # comma-separated proxy URLs
    PROXY_ROTATION = os.getenv("PROXY_ROTATION", "True").lower() in ("1", "true", "yes")
    ENABLE_COMPRESSION = os.getenv("ENABLE_COMPRESSION", "True").lower() in ("1", "true", "yes")

    # Database (for future persistence)
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/tiktok_api")

    # Monitoring
    ENABLE_METRICS = os.getenv("ENABLE_METRICS", "True").lower() in ("1", "true", "yes")
    METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))

    # Logging
    LOG_DIR = os.getenv("LOG_DIR", "/app/logs")
    LOG_FILE = os.getenv("LOG_FILE", os.path.join(LOG_DIR, "tiktok_api.log"))


# ============= REDIS CACHE MANAGER =============

# Caching removed: live-data only - no Redis cache class


# ============= RATE LIMITER =============

class AdvancedRateLimiter:
    """Token bucket rate limiter (in-memory token buckets)

    Note: This in-memory limiter is per-process and will not coordinate across multiple instances.
    For production multi-instance setups, replace with a shared store.
    """

    def __init__(self):
        self.local_buckets = defaultdict(lambda: {"tokens": ProductionConfig.RATE_LIMIT_BURST, "last_update": time.time()})

    async def check_limit(self, api_key: str) -> tuple[bool, Dict]:
        """Check rate limit using token bucket algorithm"""
        current_time = time.time()

        # Get current bucket state
        bucket_key = f"ratelimit:{api_key}"
        bucket = self.local_buckets[api_key]

        # Calculate tokens to add based on time passed
        time_passed = current_time - bucket["last_update"]
        tokens_to_add = time_passed * (ProductionConfig.RATE_LIMIT_REQUESTS_PER_MINUTE / 60)

        bucket["tokens"] = min(
            ProductionConfig.RATE_LIMIT_BURST,
            bucket["tokens"] + tokens_to_add
        )
        bucket["last_update"] = current_time

        # Check if we have tokens available
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1

            return True, {
                "allowed": True,
                "limit": ProductionConfig.RATE_LIMIT_REQUESTS_PER_MINUTE,
                "remaining": int(bucket["tokens"]),
                "reset": int(current_time + 60)
            }
        else:
            return False, {
                "allowed": False,
                "limit": ProductionConfig.RATE_LIMIT_REQUESTS_PER_MINUTE,
                "remaining": 0,
                "reset": int(current_time + (1 - bucket["tokens"]) * 60 / ProductionConfig.RATE_LIMIT_REQUESTS_PER_MINUTE),
                "retry_after": int((1 - bucket["tokens"]) * 60 / ProductionConfig.RATE_LIMIT_REQUESTS_PER_MINUTE)
            }


# ============= TIKTOK (COOKIE) CLIENT =============

class TikTokClient:
    """Fetch TikTok user posts using a user-provided cookie string.

    This client uses HTTP GET against TikTok public pages and extracts embedded JSON
    (from __NEXT_DATA__ or SIGI_STATE). It requires a valid TikTok cookie string
    (e.g. from a browser) to access private/age-gated content and reduce blocking.
    """

    def __init__(self, cookie: Optional[str] = None, timeout: int = 20):
        self.cookie = cookie or os.getenv("TIKTOK_COOKIE")
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None
        self.request_count = 0
        self.error_count = 0
    self._semaphore: Optional[asyncio.Semaphore] = None
    self._proxy_list: List[str] = []
    self._proxy_index = 0

    async def initialize(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        cookies = None
        if self.cookie:
            # Accept either a raw cookie header string or JSON-like 'k=v; k2=v2'
            cookies = {}
            for part in self.cookie.split(";"):
                if "=" in part:
                    k, v = part.strip().split("=", 1)
                    cookies[k] = v

        # Configure proxy rotation if provided via env
        if ProductionConfig.PROXIES:
            self._proxy_list = [p.strip() for p in ProductionConfig.PROXIES.split(',') if p.strip()]

        self._semaphore = asyncio.Semaphore(ProductionConfig.MAX_CONCURRENT_REQUESTS)

        # Create client without proxies here; proxies passed per-request to allow rotation
        self.client = httpx.AsyncClient(timeout=self.timeout, headers=headers, cookies=cookies)
        logger.info("✅ TikTok cookie client initialized")

    async def close(self):
        if self.client:
            await self.client.aclose()

    async def fetch_user_posts(self, username: str, max_posts: int = 100) -> List[Dict]:
        """Fetch a user's posts by scraping the user page and extracting embedded JSON."""
        if not self.client:
            await self.initialize()

        url = f"https://www.tiktok.com/@{username}"
        posts: List[Dict] = []

        # Acquire semaphore to throttle concurrency
        if not self._semaphore:
            self._semaphore = asyncio.Semaphore(ProductionConfig.MAX_CONCURRENT_REQUESTS)

        attempt = 0
        last_exc: Optional[Exception] = None

        while attempt < ProductionConfig.MAX_RETRIES:
            attempt += 1
            selected_proxy = None
            proxies_arg = None
            if self._proxy_list:
                # rotate proxies if requested
                if ProductionConfig.PROXY_ROTATION:
                    idx = self._proxy_index % len(self._proxy_list)
                    self._proxy_index = (self._proxy_index + 1) % len(self._proxy_list)
                else:
                    idx = 0
                selected_proxy = self._proxy_list[idx]
                proxies_arg = selected_proxy

            try:
                async with self._semaphore:
                    self.request_count += 1
                    # per-request proxies support
                    if proxies_arg:
                        resp = await self.client.get(url, follow_redirects=True, proxies=proxies_arg)
                    else:
                        resp = await self.client.get(url, follow_redirects=True)

                    text = resp.text

                    # Use robust parser to extract embedded JSON items
                    items = parse_embedded_json(text)
                    if not items:
                        logger.debug(f"Parse returned no items for @{username} (attempt {attempt})")
                        # Backoff and retry
                        last_exc = Exception("parsing returned no items")
                        await asyncio.sleep(ProductionConfig.BACKOFF_BASE * (2 ** (attempt - 1)))
                        continue

                    for item in items[:max_posts]:
                        posts.append(self._item_to_post(item))

                    # Throttle a bit to avoid bursts
                    await asyncio.sleep(ProductionConfig.THROTTLE_DELAY)

                    return posts

            except httpx.RequestError as e:
                self.error_count += 1
                last_exc = e
                logger.warning(f"Request error fetching @{username} (attempt {attempt}): {e}")
                await asyncio.sleep(ProductionConfig.BACKOFF_BASE * (2 ** (attempt - 1)))
                continue
            except Exception as e:
                self.error_count += 1
                last_exc = e
                logger.exception(f"Unexpected error fetching @{username} (attempt {attempt}): {e}")
                await asyncio.sleep(ProductionConfig.BACKOFF_BASE * (2 ** (attempt - 1)))
                continue

        # all attempts failed
        logger.error(f"Failed to fetch @{username} after {ProductionConfig.MAX_RETRIES} attempts: {last_exc}")
        if isinstance(last_exc, httpx.RequestError):
            raise HTTPException(status_code=503, detail="Failed to reach TikTok")
        raise HTTPException(status_code=502, detail="Failed to parse TikTok page")

    def _item_to_post(self, item: Dict) -> Dict:
        """Normalize a TikTok item into our post structure"""
        try:
            video_id = str(item.get('id') or item.get('video', {}).get('id') or item.get('aweme_id') or '')
            author = item.get('author') or item.get('authorMeta') or {}
            username = author.get('uniqueId') or author.get('name') or item.get('author', '')

            stats = item.get('stats') or item.get('statistics') or {}

            return {
                'video_id': video_id,
                'url': f"https://www.tiktok.com/@{username}/video/{video_id}",
                'description': item.get('desc') or item.get('description') or item.get('title') or '',
                'epoch_time_posted': int(item.get('createTime') or item.get('create_time') or item.get('timestamp') or 0),
                'views': int(stats.get('playCount') or stats.get('view_count') or 0),
                'likes': int(stats.get('diggCount') or stats.get('like_count') or 0),
                'comments': int(stats.get('commentCount') or stats.get('comment_count') or 0),
                'shares': int(stats.get('shareCount') or stats.get('share_count') or 0)
            }
        except Exception as e:
            logger.warning(f"⚠️  Failed to normalize item: {e}")
            return {'video_id': '', 'url': '', 'description': '', 'epoch_time_posted': 0, 'views': 0, 'likes': 0, 'comments': 0, 'shares': 0}


# ============= PARSING UTILITIES =============
def parse_embedded_json(html: str) -> List[Dict]:
    """Attempt to extract embedded JSON payloads from a TikTok HTML page.

    Handles multiple variants:
    - <script id="__NEXT_DATA__"> JSON
    - window['SIGI_STATE'] = {...}
    - window.SIGI_STATE = {...}
    - inline JSON usages like "{...}" assigned to props

    Returns a list of raw item dicts (un-normalized).
    """
    results: List[Dict] = []

    try:
        # 1) Try __NEXT_DATA__
        marker = '<script id="__NEXT_DATA__" type="application/json">'
        idx = html.find(marker)
        if idx != -1:
            start = html.find('>', idx) + 1
            end = html.find('</script>', start)
            raw = html[start:end].strip()
            try:
                data = json.loads(raw)
                items = (
                    data.get('props', {}).get('pageProps', {}).get('items') or
                    data.get('props', {}).get('pageProps', {}).get('awemeList') or []
                )
                if items:
                    return items
            except Exception:
                # fallthrough
                pass

        # 2) Try SIGI_STATE variants
        sigi_variants = ['window["SIGI_STATE"]', 'window.SIGI_STATE']
        for v in sigi_variants:
            si = html.find(v)
            if si != -1:
                eq = html.find('=', si)
                if eq != -1:
                    # attempt to extract a JSON object by finding the matching braces
                    brace_start = html.find('{', eq)
                    if brace_start != -1:
                        # simple brace matching
                        depth = 0
                        i = brace_start
                        while i < len(html):
                            if html[i] == '{':
                                depth += 1
                            elif html[i] == '}':
                                depth -= 1
                                if depth == 0:
                                    candidate = html[brace_start:i+1]
                                    try:
                                        data = json.loads(candidate)
                                        # look for ItemModule or modules with items
                                        items = []
                                        if isinstance(data, dict):
                                            if 'ItemModule' in data:
                                                items = list(data.get('ItemModule', {}).values())
                                            else:
                                                # try nested values
                                                for k in data.values():
                                                    if isinstance(k, dict) and 'ItemModule' in k:
                                                        items = list(k.get('ItemModule', {}).values())
                                                        break
                                        if items:
                                            return items
                                    except Exception:
                                        pass
                                    break
                            i += 1

        # 3) Generic fallback: try to find any large JSON blob containing 'ItemModule' or 'awemeList'
        json_start = html.find('{')
        if json_start != -1:
            # search for occurrences of awemeList or ItemModule in substrings
            for keyword in ('awemeList', 'ItemModule', 'aweme'):
                kidx = html.find(keyword)
                if kidx != -1:
                    # attempt to locate surrounding braces
                    # find earlier '{'
                    bs = html.rfind('{', 0, kidx)
                    if bs != -1:
                        # attempt small slice
                        slice_end = html.find('}', kidx)
                        if slice_end != -1:
                            candidate = html[bs:slice_end+1]
                            try:
                                data = json.loads(candidate)
                                # extract items if possible
                                items = data.get('props', {}).get('pageProps', {}).get('items') or data.get('ItemModule') or []
                                if isinstance(items, dict):
                                    return list(items.values())
                                if items:
                                    return items
                            except Exception:
                                pass

    except Exception:
        logger.exception('Error during parse_embedded_json')

    return results

    def get_metrics(self) -> Dict:
        return {
            'total_requests': self.request_count,
            'total_errors': self.error_count,
        }


# ============= PYDANTIC MODELS =============

class VideoData(BaseModel):
    video_id: str
    url: str
    description: str
    epoch_time_posted: int
    views: int = Field(ge=0)
    likes: int = Field(ge=0)
    comments: int = Field(ge=0)
    shares: int = Field(ge=0)


class MetaData(BaseModel):
    page: int
    total_pages: int
    posts_per_page: int
    total_posts: int
    start_epoch: Optional[int] = None
    end_epoch: Optional[int] = None
    first_video_epoch: Optional[int] = None
    last_video_epoch: Optional[int] = None
    request_time: int
    username: str
    cache_hit: bool = False
    processing_time_ms: float


class APIResponse(BaseModel):
    meta: MetaData
    data: List[VideoData]


# ============= FASTAPI APPLICATION =============

app = FastAPI(
    title=ProductionConfig.API_TITLE,
    version=ProductionConfig.API_VERSION,
    description="Production-grade TikTok data retrieval API (cookie-based scraping)",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if ProductionConfig.ENABLE_COMPRESSION:
    app.add_middleware(GZipMiddleware, minimum_size=1000)

# Global instances
rate_limiter: AdvancedRateLimiter = None
tiktok_client: TikTokClient = None

# API Keys (in production, load from database/env)
API_KEYS = {
    "prod_key_001": {"client": "Production Client", "tier": "enterprise", "active": True},
    "prod_key_002": {"client": "Client B", "tier": "professional", "active": True},
}


# ============= STARTUP/SHUTDOWN =============

@app.on_event("startup")
async def startup():
    """Initialize services on startup"""
    global cache, rate_limiter, ensemble_client
    # Ensure log directory exists and add file handler
    try:
        os.makedirs(ProductionConfig.LOG_DIR, exist_ok=True)
        from logging.handlers import RotatingFileHandler

        file_handler = RotatingFileHandler(ProductionConfig.LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5)
        file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
        logger.addHandler(file_handler)
    except Exception as e:
        logger.warning(f"Could not create log file handler: {e}")

    logger.info("=" * 80)
    logger.info("🚀 STARTING PRODUCTION TIKTOK API")
    logger.info("=" * 80)
    logger.info(f"Version: {ProductionConfig.API_VERSION}")
    logger.info(f"Environment: {ProductionConfig.ENVIRONMENT}")

    # Initialize rate limiter (in-memory)
    rate_limiter = AdvancedRateLimiter()
    logger.info("✅ Rate limiter initialized")

    # Initialize TikTok cookie client (can be overridden per-request via header)
    tiktok_client = TikTokClient(cookie=os.getenv("TIKTOK_COOKIE"))
    try:
        await tiktok_client.initialize()
    except Exception:
        logger.warning("TikTok client failed to initialize; will attempt per-request initialization")

    logger.info("="*80)
    logger.info("✅ ALL SYSTEMS OPERATIONAL")
    logger.info("="*80)


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown"""
    logger.info("🛑 Shutting down...")

    if tiktok_client:
        await tiktok_client.close()

    if cache:
        await cache.disconnect()

    logger.info("✅ Shutdown complete")


# ============= HELPER FUNCTIONS =============

def verify_api_key(api_key: str) -> Dict:
    """Verify API key"""
    if api_key not in API_KEYS:
        raise HTTPException(
            status_code=401,
            detail={"error": "UNAUTHORIZED", "message": "Invalid API key"}
        )

    key_info = API_KEYS[api_key]
    if not key_info.get("active"):
        raise HTTPException(
            status_code=401,
            detail={"error": "UNAUTHORIZED", "message": "API key inactive"}
        )

    return key_info


def filter_by_epoch(posts: List[Dict], start: Optional[int], end: Optional[int]) -> List[Dict]:
    """Filter posts by epoch range"""
    if not start and not end:
        return posts

    filtered = []
    for post in posts:
        epoch = post.get("epoch_time_posted", 0)
        if start and epoch < start:
            continue
        if end and epoch > end:
            continue
        filtered.append(post)

    return filtered


def paginate(posts: List[Dict], page: int, per_page: int) -> tuple[List[Dict], int]:
    """Paginate posts"""
    total = len(posts)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0

    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page

    return posts[start_idx:end_idx], total_pages


# ============= API ENDPOINTS =============

@app.get("/", tags=["System"])
async def root():
    """API root"""
    return {
        "service": ProductionConfig.API_TITLE,
        "version": ProductionConfig.API_VERSION,
        "status": "operational",
        "environment": ProductionConfig.ENVIRONMENT,
        "documentation": "/api/docs"
    }


@app.get("/health", tags=["System"])
async def health():
    """Health check"""
    tiktok_metrics = tiktok_client.get_metrics() if tiktok_client else {}

    return {
        "status": "healthy",
        "timestamp": int(time.time()),
        "version": ProductionConfig.API_VERSION,
        "services": {
                        "tiktok_client": tiktok_metrics
        }
    }


@app.get("/manage", response_class=HTMLResponse, tags=["Admin"])
async def manage_ui():
        """Simple management UI to query usernames and view results (client-side fetch)."""
        html = """
        <!doctype html>
        <html>
            <head>
                <meta charset='utf-8'/>
                <title>TikTok API - Management Console</title>
                <meta name="viewport" content="width=device-width,initial-scale=1" />
                <style>
                    :root{--bg:#0f1724;--card:#0b1220;--muted:#9aa4b2;--accent:#06b6d4}
                    body{font-family:Inter,Segoe UI,Arial,sans-serif;background:linear-gradient(180deg,#071024,#07182a);color:#e6eef6;margin:0;padding:24px}
                    .container{max-width:1100px;margin:0 auto}
                    h1{margin:0 0 12px}
                    .controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
                    input, select, button, textarea{padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);color:#e6eef6}
                    button{background:var(--accent);border:none;color:#04202a;font-weight:600}
                    .row{display:flex;gap:12px;align-items:center}
                    .meta{margin:8px 0;color:var(--muted)}
                    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
                    .card{background:var(--card);padding:12px;border-radius:10px;box-shadow:0 4px 18px rgba(2,6,23,0.6)}
                    .card a{color:var(--accent);text-decoration:none}
                    .stat{font-size:12px;color:var(--muted)}
                    pre{white-space:pre-wrap;background:#00121a;padding:12px;border-radius:8px;color:#c9e9f2}
                    .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>TikTok API — Management Console</h1>
                    <div class="meta">Live-data mode — no cache, no DB. Use a cookie if content is gated. Management UI supports history, CSV export and raw JSON.</div>

                    <div class="controls">
                        <input id="apiKey" placeholder="API Key (e.g. prod_key_001)" style="width:220px" />
                        <input id="username" placeholder="username (without @)" style="width:220px" />
                        <select id="perPage"><option value="10">10</option><option value="20" selected>20</option><option value="50">50</option></select>
                        <input id="cookie" placeholder="Optional cookie (s_v_web_id=...; ...)" style="min-width:300px" />
                        <button id="fetchBtn">Fetch Posts</button>
                        <button id="exportBtn">Export CSV</button>
                        <button id="clearHistory">Clear History</button>
                    </div>

                    <div class="toolbar">
                        <div id="status" class="stat">Ready</div>
                        <div id="rate" class="stat"></div>
                        <div id="last" class="stat"></div>
                    </div>

                    <div id="cards" class="cards" style="margin-top:16px"></div>

                    <h3 style="margin-top:18px">Raw JSON</h3>
                    <pre id="raw">No data</pre>
                </div>

                <script>
                    // Manage local state
                    const apiKeyEl = document.getElementById('apiKey');
                    const usernameEl = document.getElementById('username');
                    const cookieEl = document.getElementById('cookie');
                    const perPageEl = document.getElementById('perPage');
                    const fetchBtn = document.getElementById('fetchBtn');
                    const exportBtn = document.getElementById('exportBtn');
                    const cards = document.getElementById('cards');
                    const raw = document.getElementById('raw');
                    const status = document.getElementById('status');
                    const rate = document.getElementById('rate');
                    const last = document.getElementById('last');

                    // Load saved api key
                    apiKeyEl.value = localStorage.getItem('tt_api_key') || 'prod_key_001';

                    fetchBtn.onclick = async ()=>{
                        const u = usernameEl.value.trim();
                        if(!u){alert('enter username');return}
                        const key = apiKeyEl.value.trim();
                        const cookie = cookieEl.value.trim();
                        localStorage.setItem('tt_api_key', key);
                        status.textContent = 'Fetching...';
                        cards.innerHTML = '';

                        try{
                            const headers = {'X-API-Key': key};
                            if(cookie) headers['X-TikTok-Cookie'] = cookie;
                            const per = perPageEl.value;
                            const res = await fetch(`/v1/tiktok/posts?username=${encodeURIComponent(u)}&per_page=${per}` , {headers});
                            const data = await res.json();
                            last.textContent = new Date().toLocaleString();
                            raw.textContent = JSON.stringify(data, null, 2);
                            status.textContent = res.ok ? 'Success' : ('Error: ' + (data.detail || res.status));
                            rate.textContent = res.headers.get('X-RateLimit-Remaining') ? ('Rate remaining: '+res.headers.get('X-RateLimit-Remaining')) : '';
                            renderCards(data.data || []);
                            saveHistory(u, cookie);
                        }catch(e){
                            status.textContent = 'Fetch error';
                            raw.textContent = String(e);
                        }
                    }

                    function renderCards(items){
                        if(!items || items.length === 0){ cards.innerHTML = '<div class="stat">No posts found</div>'; return }
                        cards.innerHTML = items.map(p=>cardHtml(p)).join('\n');
                    }

                    function cardHtml(p){
                        const time = p.epoch_time_posted ? (new Date(p.epoch_time_posted*1000).toLocaleString()) : '';
                        return `\n              <div class="card">\n                <div style="display:flex;gap:8px;align-items:flex-start">\n                  <div style="flex:1">\n                    <div><a href="${p.url}" target="_blank">${escapeHtml(p.description || p.url)}</a></div>\n                    <div class="stat">${time} • views:${p.views} likes:${p.likes} comments:${p.comments} shares:${p.shares}</div>\n                  </div>\n                </div>\n              </div>`;
                    }

                    function escapeHtml(s){ return (s||'').replace(/[&<>\"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

                    function saveHistory(username, cookie){
                        const h = JSON.parse(localStorage.getItem('tt_history')||'[]');
                        h.unshift({username, cookie, when:Date.now()});
                        localStorage.setItem('tt_history', JSON.stringify(h.slice(0,30)));
                    }

                    exportBtn.onclick = ()=>{
                        const text = raw.textContent || '{}';
                        try{
                            const obj=JSON.parse(text);
                            const rows = (obj.data||[]).map(d=>[d.video_id, d.url, d.description.replace(/\n/g,' '), d.epoch_time_posted, d.views, d.likes, d.comments, d.shares]);
                            const csv = ['video_id,url,description,epoch,views,likes,comments,shares', ...rows.map(r=>r.map(escapeCsv).join(','))].join('\n');
                            const blob = new Blob([csv], {type:'text/csv'});
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href=url; a.download='tiktok_posts.csv'; a.click(); URL.revokeObjectURL(url);
                        }catch(e){ alert('No JSON to export') }
                    }

                    function escapeCsv(v){ if(v==null) return ''; return '"'+String(v).replace(/"/g,'""')+'"'; }

                    document.getElementById('clearHistory').onclick = ()=>{ localStorage.removeItem('tt_history'); alert('History cleared') }
                </script>
            </body>
        </html>
        """
        return HTMLResponse(content=html)


@app.get("/v1/tiktok/posts", response_model=APIResponse, tags=["TikTok"])
async def get_posts(
    username: str = Query(..., min_length=1, max_length=50),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    start_epoch: Optional[int] = Query(None, ge=0),
    end_epoch: Optional[int] = Query(None, ge=0),
    x_api_key: str = Header(..., alias="X-API-Key"),
    xt_cookie: Optional[str] = Header(None, alias="X-TikTok-Cookie")
):
    """
    Fetch TikTok posts by scraping TikTok pages using provided cookies

    Production endpoint with:
    - Real data scraped from TikTok using cookies
    - Redis caching for performance
    - Advanced rate limiting
    - Comprehensive error handling
    - Request metrics and logging
    """

    start_time = time.time()

    # Verify API key
    client_info = verify_api_key(x_api_key)
    logger.info(f"📨 Request from: {client_info['client']}")

    # Check rate limit
    allowed, limit_info = await rate_limiter.check_limit(x_api_key)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "RATE_LIMIT_EXCEEDED",
                "message": "Rate limit exceeded",
                "retry_after": limit_info.get("retry_after", 60)
            }
        )

    # Validate parameters
    if start_epoch and end_epoch and start_epoch > end_epoch:
        raise HTTPException(
            status_code=400,
            detail={"error": "BAD_REQUEST", "message": "start_epoch must be <= end_epoch"}
        )

    # No caching (live data only)

    # Fetch real data using TikTok cookie client
    try:
        # If request provided a cookie header, create a per-request client
        if xt_cookie:
            per_client = TikTokClient(cookie=xt_cookie)
            await per_client.initialize()
            all_posts = await per_client.fetch_user_posts(username, max_posts=200)
            await per_client.close()
        else:
            # use global client
            all_posts = await tiktok_client.fetch_user_posts(username, max_posts=200)

        if not all_posts:
            return APIResponse(
                meta=MetaData(
                    page=1,
                    total_pages=0,
                    posts_per_page=per_page,
                    total_posts=0,
                    start_epoch=start_epoch,
                    end_epoch=end_epoch,
                    first_video_epoch=None,
                    last_video_epoch=None,
                    request_time=int(time.time()),
                    username=username,
                    cache_hit=False,
                    processing_time_ms=round((time.time() - start_time) * 1000, 2)
                ),
                data=[]
            )

        # Sort and filter
        all_posts.sort(key=lambda x: x.get("epoch_time_posted", 0), reverse=True)
        filtered = filter_by_epoch(all_posts, start_epoch, end_epoch)

        # Paginate
        total_posts = len(filtered)
        total_pages = (total_posts + per_page - 1) // per_page if total_posts > 0 else 0

        if page > total_pages and total_pages > 0:
            raise HTTPException(
                status_code=400,
                detail={"error": "BAD_REQUEST", "message": f"Page {page} exceeds total pages {total_pages}"}
            )

        page_posts, _ = paginate(filtered, page, per_page)

        # Build response
        processing_time = (time.time() - start_time) * 1000

        response_data = {
            "meta": {
                "page": page,
                "total_pages": total_pages,
                "posts_per_page": per_page,
                "total_posts": total_posts,
                "start_epoch": start_epoch,
                "end_epoch": end_epoch,
                "first_video_epoch": page_posts[0]["epoch_time_posted"] if page_posts else None,
                "last_video_epoch": page_posts[-1]["epoch_time_posted"] if page_posts else None,
                "request_time": int(time.time()),
                "username": username,
                "cache_hit": False,
                "processing_time_ms": round(processing_time, 2)
            },
            "data": [VideoData(**p).dict() for p in page_posts]
        }

    # Return with headers
        json_response = JSONResponse(content=response_data)
        json_response.headers["X-Cache"] = "MISS"
        json_response.headers["X-RateLimit-Remaining"] = str(limit_info["remaining"])
        json_response.headers["X-Processing-Time"] = f"{processing_time:.2f}ms"

        logger.info(f"✅ Request completed in {processing_time:.2f}ms")

        return json_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={"error": "INTERNAL_ERROR", "message": "Internal server error"}
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True
    )
