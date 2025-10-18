"""Production TikTok API - cookie based live fetch.

This module exposes a FastAPI application that fetches TikTok post metadata
in real-time using a browser cookie supplied by the client. No database or
background cache is involved – every request hits TikTok directly and returns
structured JSON ready for analytics or frontend consumption.

Key features
------------
- Endpoint: GET /v1/tiktok/posts
- Query parameters: username (required), page, per_page, start_epoch, end_epoch
- Optional header: X-TikTok-Cookie to override the default cookie per request
- Response payload contains both metadata (pagination + time window) and an
  array of normalised posts (video id, url, description, stats, epoch time)
- Lightweight in-memory rate limiting to protect the endpoint
- Retry and backoff logic when requesting TikTok pages
- Parser shared with unit tests (see production_parser.parse_embedded_json)

⚠️  Cookie requirement --------------------------------------------------------
TikTok requires authenticated requests for consistent data. Set the constant
`HARDCODED_TIKTOK_COOKIE` below with your cookie string or pass it per request
via the `X-TikTok-Cookie` header. NEVER commit real cookies to Git – replace
the placeholder locally before deploying.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from production_parser import parse_embedded_json

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()]
)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

HARDCODED_TIKTOK_COOKIE: str = ""  # <-- replace locally with a valid TikTok cookie


class ProductionConfig:
    """Runtime configuration (adjust values to suit deployment needs)."""

    API_TITLE = "TikTok Data API - Production"
    API_VERSION = "3.0.0"
    ENVIRONMENT = "production"

    TIMEOUT_SECONDS = 15.0
    MAX_RETRIES = 3
    BACKOFF_BASE = 0.6  # seconds
    THROTTLE_DELAY = 0.2
    MAX_CONCURRENT_REQUESTS = 3
    MAX_POSTS_PER_FETCH = 200
    DEFAULT_PER_PAGE = 10
    MAX_PER_PAGE = 50
    RATE_LIMIT_TOKENS = 40  # simple in-memory bucket per client identity


USER_AGENTS: Tuple[str, ...] = (
    # Assorted current desktop Chrome UA strings
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
)


def pick_user_agent() -> str:
    return random.choice(USER_AGENTS)


def now_epoch() -> int:
    return int(time.time())


class TikTokCookieMissing(Exception):
    """Raised when the client attempts to fetch without providing a cookie."""


class TikTokFetchError(Exception):
    """Generic fetch failure after retries."""


# --------------------------------------------------------------------------- #
# Rate limiter (simple token bucket per requesting identity)
# --------------------------------------------------------------------------- #


class AdvancedRateLimiter:
    def __init__(self, tokens: int, refill_rate_per_sec: float):
        self.tokens = tokens
        self.refill_rate_per_sec = refill_rate_per_sec
        self._store: Dict[str, Dict[str, float]] = {}

    async def check_limit(self, identity: str) -> Tuple[bool, Dict[str, float]]:
        bucket = self._store.setdefault(identity, {"tokens": self.tokens, "last": time.time()})
        current = time.time()
        elapsed = current - bucket["last"]
        bucket["tokens"] = min(self.tokens, bucket["tokens"] + elapsed * self.refill_rate_per_sec)
        bucket["last"] = current
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True, {"remaining": math.floor(bucket["tokens"])}
        return False, {"remaining": 0, "retry_after": ProductionConfig.THROTTLE_DELAY}


# --------------------------------------------------------------------------- #
# TikTok client
# --------------------------------------------------------------------------- #


class TikTokClient:
    """Thin async HTTP client that fetches TikTok profile pages using cookies."""

    def __init__(
        self,
        cookie: Optional[str],
        *,
        timeout: float,
        max_retries: int,
        backoff_base: float,
        max_concurrent_requests: int,
    ) -> None:
        self._default_cookie = (cookie or "").strip()
        self._timeout = timeout
        self._max_retries = max_retries
        self._backoff_base = backoff_base
        self._semaphore = asyncio.Semaphore(max_concurrent_requests)
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                headers={
                    "User-Agent": pick_user_agent(),
                    "Accept-Language": "en-US,en;q=0.9",
                },
                http2=True,
            )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def fetch_user_posts(
        self,
        username: str,
        *,
        max_posts: int,
        cookie_override: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        await self.start()
        if self._client is None:
            raise TikTokFetchError("HTTP client not initialised")

        cookie = (cookie_override or self._default_cookie or HARDCODED_TIKTOK_COOKIE).strip()
        if not cookie:
            raise TikTokCookieMissing(
                "TikTok cookie required. Provide X-TikTok-Cookie header or set HARDCODED_TIKTOK_COOKIE."
            )

        url = f"https://www.tiktok.com/@{username}"
        attempt = 0
        last_error: Optional[Exception] = None

        async with self._semaphore:
            while attempt < self._max_retries:
                attempt += 1
                headers = {
                    "User-Agent": pick_user_agent(),
                    "Referer": "https://www.tiktok.com/",
                    "Cookie": cookie,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Cache-Control": "no-cache",
                }
                try:
                    logger.debug("Fetching TikTok page attempt=%s username=%s", attempt, username)
                    response = await self._client.get(
                        url,
                        headers=headers,
                        follow_redirects=True,
                    )
                    response.raise_for_status()
                    html = response.text
                    items = parse_embedded_json(html)
                    if not items:
                        raise TikTokFetchError("No embedded JSON found in TikTok page")
                    normalised = self._normalise_items(items, username, max_posts=max_posts)
                    if normalised:
                        return normalised
                    raise TikTokFetchError("Unable to normalise TikTok items from response")
                except Exception as exc:
                    last_error = exc
                    backoff = self._backoff_base * (2 ** (attempt - 1))
                    logger.warning(
                        "TikTok fetch failed attempt=%s username=%s error=%s backoff=%.2fs",
                        attempt,
                        username,
                        exc,
                        backoff,
                    )
                    await asyncio.sleep(backoff)

        raise TikTokFetchError(str(last_error) if last_error else "TikTok fetch failed")

    @staticmethod
    def _normalise_items(
        items: Iterable[Dict[str, Any]],
        username: str,
        *,
        max_posts: int,
    ) -> List[Dict[str, Any]]:
        normalised: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for raw in items:
            post = TikTokClient._normalise_item(raw, username)
            if not post:
                continue
            vid = post["video_id"]
            if vid in seen:
                continue
            seen.add(vid)
            normalised.append(post)
            if len(normalised) >= max_posts:
                break

        normalised.sort(key=lambda p: p["epoch_time_posted"], reverse=True)
        return normalised

    @staticmethod
    def _normalise_item(raw: Dict[str, Any], username: str) -> Optional[Dict[str, Any]]:
        """Transform heterogeneous TikTok structures into a consistent shape."""
        # Some variants nest actual item inside keys like "itemInfos" or "itemInfo"
        if "itemInfos" in raw and isinstance(raw["itemInfos"], dict):
            raw = {**raw, **raw["itemInfos"]}
        if "itemInfo" in raw and isinstance(raw["itemInfo"], dict):
            raw = {**raw, **raw["itemInfo"]}

        video_id = (
            raw.get("id")
            or raw.get("aweme_id")
            or raw.get("awemeId")
            or raw.get("item_id")
            or raw.get("itemId")
        )
        if not video_id:
            return None

        stats = (
            raw.get("stats")
            or raw.get("statistics")
            or raw.get("itemInfos", {}).get("statistics")
            or {}
        )

        description = (
            raw.get("desc")
            or raw.get("description")
            or raw.get("shareTitle")
            or ""
        )

        create_time = (
            raw.get("createTime")
            or raw.get("create_time")
            or raw.get("create_time")
            or raw.get("authorStats", {}).get("createTime")
            or raw.get("itemInfos", {}).get("createTime")
        )
        if create_time is None:
            return None

        def _as_int(value: Any) -> int:
            try:
                return int(float(value))
            except (TypeError, ValueError):
                return 0

        epoch_time = _as_int(create_time)

        def _pick_stat(*keys: str) -> int:
            for key in keys:
                if key in stats and stats[key] is not None:
                    return _as_int(stats[key])
                if raw.get(key) is not None:
                    return _as_int(raw[key])
            return 0

        views = _pick_stat("playCount", "viewCount", "play_count", "views")
        likes = _pick_stat("diggCount", "likeCount", "likes")
        comments = _pick_stat("commentCount", "comments")
        shares = _pick_stat("shareCount", "shares")

        video = raw.get("video") or raw.get("itemInfos", {}).get("video") or {}
        url = (
            video.get("shareUrl")
            or video.get("downloadAddr")
            or f"https://www.tiktok.com/@{username}/video/{video_id}"
        )

        return {
            "video_id": str(video_id),
            "url": url,
            "description": description,
            "epoch_time_posted": epoch_time,
            "views": views,
            "likes": likes,
            "comments": comments,
            "shares": shares,
        }


# --------------------------------------------------------------------------- #
# Helper functions
# --------------------------------------------------------------------------- #


def filter_by_epoch(posts: List[Dict[str, Any]], start_epoch: Optional[int], end_epoch: Optional[int]) -> List[Dict[str, Any]]:
    if start_epoch is None and end_epoch is None:
        return posts
    filtered: List[Dict[str, Any]] = []
    for post in posts:
        epoch = post["epoch_time_posted"]
        if start_epoch is not None and epoch < start_epoch:
            continue
        if end_epoch is not None and epoch > end_epoch:
            continue
        filtered.append(post)
    return filtered


def paginate(posts: List[Dict[str, Any]], page: int, per_page: int) -> Tuple[List[Dict[str, Any]], int]:
    total_posts = len(posts)
    if total_posts == 0:
        return [], 0
    total_pages = math.ceil(total_posts / per_page)
    start = (page - 1) * per_page
    end = start + per_page
    return posts[start:end], total_pages


# --------------------------------------------------------------------------- #
# Pydantic models for structured responses
# --------------------------------------------------------------------------- #


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
    processing_time_ms: float


class APIResponse(BaseModel):
    meta: MetaData
    data: List[VideoData]


# --------------------------------------------------------------------------- #
# FastAPI application setup
# --------------------------------------------------------------------------- #


app = FastAPI(
    title=ProductionConfig.API_TITLE,
    version=ProductionConfig.API_VERSION,
    description="Production-grade TikTok data retrieval API (cookie-based scraping)",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    app.add_middleware(GZipMiddleware, minimum_size=1024)
except Exception:  # pragma: no cover - gzip optional
    pass


rate_limiter: Optional[AdvancedRateLimiter] = None
tiktok_client: Optional[TikTokClient] = None


async def enforce_rate_limit(request: Request) -> Dict[str, float]:
    if not rate_limiter:
        return {"remaining": ProductionConfig.RATE_LIMIT_TOKENS}
    identity = request.headers.get("X-Forwarded-For") or (request.client.host if request.client else "anon")
    allowed, info = await rate_limiter.check_limit(identity)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "RATE_LIMIT_EXCEEDED",
                "message": "Rate limit exceeded. Please retry shortly.",
                "retry_after": info.get("retry_after", ProductionConfig.THROTTLE_DELAY),
            },
        )
    return info


@app.on_event("startup")
async def startup_event() -> None:
    global rate_limiter, tiktok_client
    rate_limiter = AdvancedRateLimiter(
        tokens=ProductionConfig.RATE_LIMIT_TOKENS,
        refill_rate_per_sec=ProductionConfig.RATE_LIMIT_TOKENS / 60.0,
    )
    tiktok_client = TikTokClient(
        cookie=HARDCODED_TIKTOK_COOKIE,
        timeout=ProductionConfig.TIMEOUT_SECONDS,
        max_retries=ProductionConfig.MAX_RETRIES,
        backoff_base=ProductionConfig.BACKOFF_BASE,
        max_concurrent_requests=ProductionConfig.MAX_CONCURRENT_REQUESTS,
    )
    await tiktok_client.start()
    logger.info("Startup complete. TikTok client ready.")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if tiktok_client:
        await tiktok_client.close()
        logger.info("TikTok client closed.")


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@app.get("/", tags=["System"])
async def root() -> Dict[str, str]:
    return {"service": ProductionConfig.API_TITLE, "version": ProductionConfig.API_VERSION}


@app.get("/v1/tiktok/posts", response_model=APIResponse, tags=["TikTok"])
async def get_tiktok_posts(
    request: Request,
    username: str = Query(..., min_length=1, max_length=64, description="TikTok username without @"),
    page: int = Query(1, ge=1),
    per_page: int = Query(ProductionConfig.DEFAULT_PER_PAGE, ge=1, le=ProductionConfig.MAX_PER_PAGE),
    start_epoch: Optional[int] = Query(None, ge=0),
    end_epoch: Optional[int] = Query(None, ge=0),
    xt_cookie: Optional[str] = Header(None, alias="X-TikTok-Cookie"),
) -> JSONResponse:
    if not username.strip():
        raise HTTPException(status_code=400, detail={"error": "BAD_REQUEST", "message": "username required"})

    if start_epoch and end_epoch and start_epoch > end_epoch:
        raise HTTPException(
            status_code=400,
            detail={"error": "BAD_REQUEST", "message": "start_epoch must be <= end_epoch"},
        )

    if not tiktok_client:
        raise HTTPException(
            status_code=500,
            detail={"error": "SERVER_NOT_READY", "message": "TikTok client not initialised"},
        )

    rate_info = await enforce_rate_limit(request)

    start_time = time.perf_counter()
    try:
        posts = await tiktok_client.fetch_user_posts(
            username=username,
            max_posts=ProductionConfig.MAX_POSTS_PER_FETCH,
            cookie_override=xt_cookie,
        )
    except TikTokCookieMissing as exc:
        raise HTTPException(
            status_code=428,
            detail={"error": "TIKTOK_COOKIE_MISSING", "message": str(exc)},
        ) from exc
    except TikTokFetchError as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "TIKTOK_FETCH_FAILED", "message": str(exc)},
        ) from exc

    filtered = filter_by_epoch(posts, start_epoch=start_epoch, end_epoch=end_epoch)
    page_posts, total_pages = paginate(filtered, page, per_page)

    if total_pages and page > total_pages:
        raise HTTPException(
            status_code=400,
            detail={"error": "BAD_REQUEST", "message": f"page {page} exceeds total pages {total_pages}"},
        )

    processing_time_ms = (time.perf_counter() - start_time) * 1000
    meta = MetaData(
        page=page,
        total_pages=total_pages,
        posts_per_page=per_page,
        total_posts=len(filtered),
        start_epoch=start_epoch,
        end_epoch=end_epoch,
        first_video_epoch=page_posts[0]["epoch_time_posted"] if page_posts else None,
        last_video_epoch=page_posts[-1]["epoch_time_posted"] if page_posts else None,
        request_time=now_epoch(),
        username=username,
        processing_time_ms=round(processing_time_ms, 2),
    )

    response_payload = APIResponse(
        meta=meta,
        data=[VideoData(**post) for post in page_posts],
    )

    json_response = JSONResponse(content=response_payload.dict())
    json_response.headers["X-RateLimit-Remaining"] = str(rate_info.get("remaining", 0))
    json_response.headers["X-Processing-Time-ms"] = f"{processing_time_ms:.2f}"
    return json_response


@app.get("/manage", response_class=HTMLResponse, include_in_schema=False)
async def management_ui() -> HTMLResponse:
    """Minimalistic UI to run manual queries from a browser."""
    html = """
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>TikTok API Console</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 2rem; background: #0d1117; color: #e6edf3; }
        input, button, textarea { padding: 0.6rem; border-radius: 6px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; }
        label { display: block; margin-top: 1rem; font-weight: 600; }
        button { cursor: pointer; margin-top: 1rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-top: 2rem; }
        .card { border: 1px solid #30363d; border-radius: 10px; padding: 1rem; background: #161b22; box-shadow: 0 0 20px rgba(0,0,0,0.2); }
        pre { overflow-x: auto; background: #161b22; padding: 1rem; border-radius: 6px; }
        a { color: #58a6ff; }
      </style>
    </head>
    <body>
      <h1>TikTok Post Explorer</h1>
      <p>Provide a TikTok username and optional cookie to fetch recent posts.</p>
      <form id="query-form">
        <label>Username <input id="username" required placeholder="techreviews"></label>
        <label>Page <input id="page" type="number" min="1" value="1"></label>
        <label>Per Page <input id="perPage" type="number" min="1" max="50" value="10"></label>
        <label>Start Epoch <input id="startEpoch" type="number" min="0" placeholder="optional"></label>
        <label>End Epoch <input id="endEpoch" type="number" min="0" placeholder="optional"></label>
        <label>TikTok Cookie (optional override)<textarea id="cookie" rows="3" placeholder="s_v_web_id=...; tt_webid_v2=..."></textarea></label>
        <button type="submit">Fetch</button>
      </form>
      <section id="meta"></section>
      <div class="grid" id="results"></div>
      <script>
        const form = document.getElementById('query-form');
        const meta = document.getElementById('meta');
        const results = document.getElementById('results');
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          results.innerHTML = '';
          meta.innerHTML = '<p>Loading...</p>';
          const username = document.getElementById('username').value.trim();
          const page = document.getElementById('page').value;
          const perPage = document.getElementById('perPage').value;
          const startEpoch = document.getElementById('startEpoch').value;
          const endEpoch = document.getElementById('endEpoch').value;
          const cookie = document.getElementById('cookie').value.trim();
          const params = new URLSearchParams({ username, page, per_page: perPage });
          if (startEpoch) params.append('start_epoch', startEpoch);
          if (endEpoch) params.append('end_epoch', endEpoch);
          try {
            const response = await fetch(`/v1/tiktok/posts?${params.toString()}`, {
              headers: cookie ? { 'X-TikTok-Cookie': cookie } : undefined,
            });
            if (!response.ok) {
              const errorBody = await response.json().catch(() => ({}));
              throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(errorBody)}`);
            }
            const data = await response.json();
            meta.innerHTML = `
              <pre>${JSON.stringify(data.meta, null, 2)}</pre>
              <p>Total posts: ${data.meta.total_posts}</p>
            `;
            if (!data.data.length) {
              results.innerHTML = '<p>No posts matched the filters.</p>';
              return;
            }
            results.innerHTML = data.data.map(item => `
              <article class="card">
                <h3>${item.video_id}</h3>
                <p>${item.description || '(no description)'}</p>
                <p><strong>Epoch:</strong> ${item.epoch_time_posted}</p>
                <p><strong>Views:</strong> ${item.views.toLocaleString()}</p>
                <p><strong>Likes:</strong> ${item.likes.toLocaleString()}</p>
                <p><strong>Comments:</strong> ${item.comments.toLocaleString()}</p>
                <p><strong>Shares:</strong> ${item.shares.toLocaleString()}</p>
                <p><a href="${item.url}" target="_blank">Open on TikTok</a></p>
              </article>
            `).join('');
          } catch (err) {
            meta.innerHTML = `<p style="color:#ff7b72">Error: ${err.message}</p>`;
          }
        });
      </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)


# --------------------------------------------------------------------------- #
# Application entrypoint for local development
# --------------------------------------------------------------------------- #


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "production_api_real:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False,
    )
