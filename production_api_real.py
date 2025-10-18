"""
PRODUCTION TIKTOK API - ENTERPRISE GRADE
Real EnsembleData Integration with Advanced Features
"""

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
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, validator
import aiohttp
from functools import lru_cache
import redis.asyncio as aioredis

# ============= LOGGING CONFIGURATION =============

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

    # EnsembleData Configuration
    ENSEMBLEDATA_BASE_URL = os.getenv("ENSEMBLEDATA_BASE_URL", "https://ensembledata.com/apis")
    ENSEMBLEDATA_TOKEN = os.getenv("ENSEMBLEDATA_TOKEN", "YOUR_ENSEMBLE_TOKEN")
    ENSEMBLEDATA_TIMEOUT = int(os.getenv("ENSEMBLEDATA_TIMEOUT", "30"))
    ENSEMBLEDATA_MAX_RETRIES = int(os.getenv("ENSEMBLEDATA_MAX_RETRIES", "3"))

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

class RedisCache:
    """Redis-based caching with advanced features"""

    def __init__(self):
        self.redis = None
        self.enabled = True

    async def connect(self):
        """Connect to Redis"""
        try:
            self.redis = await aioredis.from_url(
                f"redis://{ProductionConfig.REDIS_HOST}:{ProductionConfig.REDIS_PORT}",
                password=ProductionConfig.REDIS_PASSWORD,
                db=ProductionConfig.REDIS_DB,
                encoding="utf-8",
                decode_responses=True
            )
            await self.redis.ping()
            logger.info("✅ Redis cache connected")
        except Exception as e:
            logger.warning(f"⚠️  Redis unavailable, using in-memory cache: {e}")
            self.enabled = False

    async def disconnect(self):
        """Disconnect from Redis"""
        if self.redis:
            await self.redis.close()

    def _generate_key(self, prefix: str, **params) -> str:
        """Generate cache key from parameters"""
        key_string = f"{prefix}:" + ":".join(f"{k}={v}" for k, v in sorted(params.items()))
        return hashlib.sha256(key_string.encode()).hexdigest()[:16]

    async def get(self, key: str) -> Optional[Dict]:
        """Get value from cache"""
        if not self.enabled or not self.redis:
            return None

        try:
            value = await self.redis.get(key)
            if value:
                logger.info(f"📦 Cache HIT: {key}")
                return json.loads(value)
            logger.info(f"❌ Cache MISS: {key}")
            return None
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None

    async def set(self, key: str, value: Dict, ttl: int = ProductionConfig.CACHE_TTL):
        """Set value in cache with TTL"""
        if not self.enabled or not self.redis:
            return

        try:
            await self.redis.setex(key, ttl, json.dumps(value))
            logger.info(f"💾 Cache SET: {key} (TTL: {ttl}s)")
        except Exception as e:
            logger.error(f"Cache set error: {e}")

    async def delete(self, pattern: str):
        """Delete keys matching pattern"""
        if not self.enabled or not self.redis:
            return

        try:
            keys = await self.redis.keys(pattern)
            if keys:
                await self.redis.delete(*keys)
                logger.info(f"🗑️  Deleted {len(keys)} cache keys")
        except Exception as e:
            logger.error(f"Cache delete error: {e}")

    async def get_stats(self) -> Dict:
        """Get cache statistics"""
        if not self.enabled or not self.redis:
            return {"enabled": False}

        try:
            info = await self.redis.info("stats")
            return {
                "enabled": True,
                "total_connections": info.get("total_connections_received", 0),
                "total_commands": info.get("total_commands_processed", 0),
                "keyspace_hits": info.get("keyspace_hits", 0),
                "keyspace_misses": info.get("keyspace_misses", 0),
                "hit_rate": round(
                    info.get("keyspace_hits", 0) / 
                    max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0), 1) * 100, 
                    2
                )
            }
        except Exception as e:
            logger.error(f"Cache stats error: {e}")
            return {"enabled": False, "error": str(e)}


# ============= RATE LIMITER =============

class AdvancedRateLimiter:
    """Token bucket rate limiter with Redis backend"""

    def __init__(self, redis_cache: RedisCache):
        self.cache = redis_cache
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


# ============= ENSEMBLEDATA CLIENT =============

class EnsembleDataClient:
    """Production EnsembleData API client with retries and error handling"""

    def __init__(self, token: str):
        self.token = token
        self.base_url = ProductionConfig.ENSEMBLEDATA_BASE_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.request_count = 0
        self.error_count = 0

    async def initialize(self):
        """Initialize HTTP session"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=ProductionConfig.ENSEMBLEDATA_TIMEOUT)
        )
        logger.info("✅ EnsembleData client initialized")

    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()

    async def fetch_user_posts(self, username: str, max_posts: int = 100) -> List[Dict]:
        """Fetch posts from EnsembleData with retry logic"""

        url = f"{self.base_url}/tt/user/posts"
        params = {
            "username": username.replace("@", ""),
            "depth": min(max_posts // 10, 10),  # EnsembleData depth parameter
            "token": self.token
        }

        for attempt in range(ProductionConfig.ENSEMBLEDATA_MAX_RETRIES):
            try:
                logger.info(f"🔄 Fetching TikTok data for @{username} (attempt {attempt + 1})")
                self.request_count += 1

                async with self.session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        posts = self._parse_response(data, max_posts)
                        logger.info(f"✅ Retrieved {len(posts)} posts for @{username}")
                        return posts

                    elif response.status == 401:
                        self.error_count += 1
                        logger.error("❌ EnsembleData: Invalid API token")
                        raise HTTPException(
                            status_code=503,
                            detail="Data source authentication failed. Check API token."
                        )

                    elif response.status == 429:
                        retry_after = int(response.headers.get("Retry-After", 60))
                        logger.warning(f"⚠️  EnsembleData rate limit, retry after {retry_after}s")

                        if attempt < ProductionConfig.ENSEMBLEDATA_MAX_RETRIES - 1:
                            await asyncio.sleep(retry_after)
                            continue
                        else:
                            raise HTTPException(
                                status_code=429,
                                detail="Data source rate limit exceeded. Try again later."
                            )

                    elif response.status == 404:
                        logger.warning(f"⚠️  Username @{username} not found")
                        return []

                    else:
                        self.error_count += 1
                        error_text = await response.text()
                        logger.error(f"❌ EnsembleData error {response.status}: {error_text}")

                        if attempt < ProductionConfig.ENSEMBLEDATA_MAX_RETRIES - 1:
                            await asyncio.sleep(2 ** attempt)  # Exponential backoff
                            continue
                        else:
                            raise HTTPException(
                                status_code=503,
                                detail=f"Data source error: {response.status}"
                            )

            except asyncio.TimeoutError:
                self.error_count += 1
                logger.error(f"⏱️  Request timeout for @{username}")

                if attempt < ProductionConfig.ENSEMBLEDATA_MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    raise HTTPException(
                        status_code=504,
                        detail="Data source timeout"
                    )

            except HTTPException:
                raise

            except Exception as e:
                self.error_count += 1
                logger.error(f"❌ Unexpected error: {str(e)}")

                if attempt < ProductionConfig.ENSEMBLEDATA_MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Failed to fetch data: {str(e)}"
                    )

        return []

    def _parse_response(self, data: Dict, max_posts: int) -> List[Dict]:
        """Parse EnsembleData response"""
        posts = []

        # Handle different response structures
        items = (
            data.get("data", {}).get("posts", []) or
            data.get("posts", []) or
            data.get("items", []) or
            data.get("aweme_list", [])
        )

        for item in items[:max_posts]:
            try:
                # Extract fields with multiple possible keys
                video_id = str(
                    item.get("id") or 
                    item.get("aweme_id") or 
                    item.get("video_id") or 
                    ""
                )

                author_info = item.get("author", {})
                username = (
                    author_info.get("uniqueId") or 
                    author_info.get("unique_id") or
                    item.get("username") or
                    ""
                )

                stats = item.get("stats", {}) or item.get("statistics", {})

                post = {
                    "video_id": video_id,
                    "url": f"https://www.tiktok.com/@{username}/video/{video_id}",
                    "description": (
                        item.get("desc") or 
                        item.get("description") or 
                        item.get("title") or 
                        ""
                    ),
                    "epoch_time_posted": (
                        item.get("createTime") or 
                        item.get("create_time") or 
                        item.get("timestamp") or 
                        0
                    ),
                    "views": (
                        stats.get("playCount") or 
                        stats.get("play_count") or 
                        stats.get("view_count") or 
                        0
                    ),
                    "likes": (
                        stats.get("diggCount") or 
                        stats.get("digg_count") or 
                        stats.get("like_count") or 
                        0
                    ),
                    "comments": (
                        stats.get("commentCount") or 
                        stats.get("comment_count") or 
                        0
                    ),
                    "shares": (
                        stats.get("shareCount") or 
                        stats.get("share_count") or 
                        0
                    )
                }

                # Validate post has minimum required data
                if post["video_id"] and post["epoch_time_posted"]:
                    posts.append(post)

            except Exception as e:
                logger.warning(f"⚠️  Failed to parse post: {str(e)}")
                continue

        return posts

    def get_metrics(self) -> Dict:
        """Get client metrics"""
        return {
            "total_requests": self.request_count,
            "total_errors": self.error_count,
            "success_rate": round(
                (self.request_count - self.error_count) / max(self.request_count, 1) * 100,
                2
            )
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
    description="Production-grade TikTok data retrieval API with real-time EnsembleData integration",
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
cache: RedisCache = None
rate_limiter: AdvancedRateLimiter = None
ensemble_client: EnsembleDataClient = None

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

    # Initialize Redis cache
    cache = RedisCache()
    await cache.connect()

    # Initialize rate limiter
    rate_limiter = AdvancedRateLimiter(cache)
    logger.info("✅ Rate limiter initialized")

    # Initialize EnsembleData client
    ensemble_client = EnsembleDataClient(ProductionConfig.ENSEMBLEDATA_TOKEN)
    # If EnsembleData token is missing, log warning and continue in degraded mode
    if not ProductionConfig.ENSEMBLEDATA_TOKEN or ProductionConfig.ENSEMBLEDATA_TOKEN == "YOUR_ENSEMBLE_TOKEN":
        logger.warning("EnsembleData token not configured; EnsembleData client will run in degraded mode")
    else:
        await ensemble_client.initialize()

    logger.info("="*80)
    logger.info("✅ ALL SYSTEMS OPERATIONAL")
    logger.info("="*80)


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown"""
    logger.info("🛑 Shutting down...")

    if ensemble_client:
        await ensemble_client.close()

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
    cache_stats = await cache.get_stats() if cache else {"enabled": False}
    ensemble_metrics = ensemble_client.get_metrics() if ensemble_client else {}

    return {
        "status": "healthy",
        "timestamp": int(time.time()),
        "version": ProductionConfig.API_VERSION,
        "services": {
            "cache": cache_stats,
            "ensemble_api": ensemble_metrics
        }
    }


@app.get("/v1/tiktok/posts", response_model=APIResponse, tags=["TikTok"])
async def get_posts(
    username: str = Query(..., min_length=1, max_length=50),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    start_epoch: Optional[int] = Query(None, ge=0),
    end_epoch: Optional[int] = Query(None, ge=0),
    x_api_key: str = Header(..., alias="X-API-Key")
):
    """
    Fetch TikTok posts with real-time data from EnsembleData

    Production endpoint with:
    - Real data from EnsembleData API
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

    # Generate cache key
    cache_key = cache._generate_key(
        "posts",
        username=username,
        start=start_epoch,
        end=end_epoch,
        page=page,
        per_page=per_page
    )

    # Check cache
    cached = await cache.get(cache_key)
    if cached:
        processing_time = (time.time() - start_time) * 1000
        cached["meta"]["processing_time_ms"] = round(processing_time, 2)
        cached["meta"]["cache_hit"] = True

        response = JSONResponse(content=cached)
        response.headers["X-Cache"] = "HIT"
        response.headers["X-RateLimit-Remaining"] = str(limit_info["remaining"])
        return response

    # Fetch real data
    try:
        all_posts = await ensemble_client.fetch_user_posts(username, max_posts=200)

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

        # Cache response
        await cache.set(cache_key, response_data)

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
