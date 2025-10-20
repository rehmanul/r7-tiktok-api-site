import { createHash } from 'crypto';
import fs from 'fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DEFAULT_VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };

const NAVIGATION_TIMEOUT_MS = normalizeInteger(process.env.NAVIGATION_TIMEOUT_MS, 30000);
const CONTENT_WAIT_MS = normalizeInteger(process.env.CONTENT_WAIT_MS, 5000);

const RAW_CACHE_TTL_SECONDS = normalizeInteger(process.env.CACHE_TTL, 120);
const CACHE_TTL_MS = RAW_CACHE_TTL_SECONDS > 0 ? RAW_CACHE_TTL_SECONDS * 1000 : 0;
const CACHE_MAX_ENTRIES = (() => {
  const value = normalizeInteger(process.env.CACHE_MAX_ENTRIES, 100);
  return value > 0 ? value : 0;
})();
const CACHE_ENABLED = CACHE_TTL_MS > 0 && CACHE_MAX_ENTRIES > 0;

const RATE_LIMIT_RULES = buildRateLimitRules();
const rateLimitState = new Map();
const responseCache = new Map();

let cachedExecutablePath;

function ensureChromiumCacheDir() {
  const defaultCache = '/tmp/chromium-cache';
  const targetDir = process.env.PUPPETEER_CACHE_DIR || defaultCache;
  process.env.PUPPETEER_CACHE_DIR = targetDir;

  if (!targetDir.startsWith('/tmp')) {
    return;
  }

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    }
  } catch (err) {
    console.warn('Unable to ensure chromium cache directory:', err);
  }
}

function normalizeInteger(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function buildRateLimitRules() {
  const rules = [];

  const minuteLimit = deriveRateLimit(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE, 60);
  if (minuteLimit) {
    rules.push({ windowMs: 60_000, limit: minuteLimit, label: 'Minute' });
  }

  const hourLimit = deriveRateLimit(process.env.RATE_LIMIT_REQUESTS_PER_HOUR, 1_000);
  if (hourLimit) {
    rules.push({ windowMs: 3_600_000, limit: hourLimit, label: 'Hour' });
  }

  return rules;
}

function deriveRateLimit(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  if (parsed === 0) {
    return null;
  }
  return parsed;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clonePayload(payload) {
  return typeof structuredClone === 'function'
    ? structuredClone(payload)
    : JSON.parse(JSON.stringify(payload));
}

function getQueryParam(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseIntegerParameter(raw, { name, defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${name}`);
  }
  return Math.min(parsed, max);
}

function parseOptionalEpoch(raw, name) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}`);
  }
  return parsed;
}

function normalizeCookiesFromString(rawCookie) {
  return rawCookie
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [name, ...rest] = segment.split('=');
      const value = rest.join('=');
      return { name: name?.trim(), value: value?.trim() };
    })
    .filter(({ name, value }) => Boolean(name) && Boolean(value))
    .map(({ name, value }) => ({
      name,
      value,
      domain: '.tiktok.com',
      path: '/'
    }));
}

function normalizeCookiesFromJson(rawCookie) {
  try {
    const parsed = JSON.parse(rawCookie);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((cookie) => cookie && cookie.name && cookie.value)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.tiktok.com',
        path: cookie.path || '/',
        expires: cookie.expires
      }));
  } catch {
    return [];
  }
}

function normalizeCookieInput(rawCookie) {
  if (!rawCookie) {
    return [];
  }
  const trimmed = rawCookie.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const cookies = normalizeCookiesFromJson(trimmed);
    if (cookies.length) {
      return cookies;
    }
  }
  return normalizeCookiesFromString(trimmed);
}

function decodeCookieHeader(rawHeader) {
  if (!rawHeader) {
    return [];
  }
  let decoded = rawHeader;
  try {
    decoded = Buffer.from(rawHeader, 'base64').toString('utf-8');
  } catch {
    decoded = rawHeader;
  }
  return normalizeCookieInput(decoded);
}

function getCookies(req) {
  const cookies = [];

  const headerValue = req.headers['x-tiktok-cookie'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    cookies.push(...decodeCookieHeader(headerValue.trim()));
  }

  if (!cookies.length && process.env.TIKTOK_COOKIE) {
    cookies.push(...normalizeCookieInput(process.env.TIKTOK_COOKIE));
  }

  if (!cookies.length) {
    const fallbackCookies = [
      { name: 'sessionid', value: process.env.TIKTOK_SESSION_ID },
      { name: 'tt_webid', value: process.env.TIKTOK_WEBID }
    ].filter((cookie) => typeof cookie.value === 'string' && cookie.value.trim().length > 0);

    cookies.push(
      ...fallbackCookies.map((cookie) => ({
        ...cookie,
        domain: '.tiktok.com',
        path: '/'
      }))
    );
  }

  const unique = [];
  const seen = new Set();

  for (const cookie of cookies) {
    if (!cookie || !cookie.name || !cookie.value) {
      continue;
    }
    const key = `${cookie.domain || ''}:${cookie.path || ''}:${cookie.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '.tiktok.com',
      path: cookie.path || '/'
    });
  }

  return unique;
}

function getClientIdentifier(req) {
  const candidates = [
    req.headers['cf-connecting-ip'],
    req.headers['x-real-ip'],
    req.headers['x-forwarded-for']
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.split(',')[0].trim();
    }
  }

  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress;
  }

  return 'anonymous';
}

function enforceRateLimit(req) {
  if (!RATE_LIMIT_RULES.length) {
    return { limited: false, retryAfterSeconds: 0, headers: {} };
  }

  const clientKey = getClientIdentifier(req);
  const now = Date.now();
  const existing = rateLimitState.get(clientKey) ?? [];

  const updated = [];
  let limited = false;
  let retryAfterSeconds = 0;

  RATE_LIMIT_RULES.forEach((rule, index) => {
    const previous = existing[index];
    const previousReset = previous && typeof previous.resetTime === 'number' ? previous.resetTime : now + rule.windowMs;
    const previousCount = previous && typeof previous.count === 'number' ? previous.count : 0;

    let count = previousCount;
    let resetTime = previousReset;

    if (now >= previousReset) {
      count = 0;
      resetTime = now + rule.windowMs;
    }

    count += 1;

    if (count > rule.limit) {
      limited = true;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((resetTime - now) / 1000));
    }

    updated[index] = {
      count,
      limit: rule.limit,
      resetTime,
      label: rule.label
    };
  });

  rateLimitState.set(clientKey, updated);

  const headers = {};
  updated.forEach((bucket) => {
    const remaining = Math.max(bucket.limit - Math.min(bucket.count, bucket.limit), 0);
    headers[`X-RateLimit-Limit-${bucket.label}`] = bucket.limit;
    headers[`X-RateLimit-Remaining-${bucket.label}`] = remaining;
    headers[`X-RateLimit-Reset-${bucket.label}`] = Math.ceil(bucket.resetTime / 1000);
  });

  return { limited, retryAfterSeconds, headers };
}

function applyResponseHeaders(res, headers) {
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      res.setHeader(key, value);
    }
  });
}

function createCacheKey({ username, page, perPage, startEpoch, endEpoch, cookies }) {
  const normalizedUsername = username.toLowerCase();
  const base = [normalizedUsername, page, perPage, startEpoch ?? '', endEpoch ?? ''].join('::');

  if (!Array.isArray(cookies) || !cookies.length) {
    return `${base}::public`;
  }

  const sortedCookies = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .sort()
    .join('|');

  const cookieHash = createHash('sha256').update(sortedCookies).digest('hex');
  return `${base}::${cookieHash}`;
}

function getCachedResponse(cacheKey) {
  if (!CACHE_ENABLED) {
    return null;
  }
  const entry = responseCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  const expiresInSeconds = Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  return { payload: clonePayload(entry.payload), expiresInSeconds };
}

function storeCachedResponse(cacheKey, payload) {
  if (!CACHE_ENABLED) {
    return;
  }

  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) {
      responseCache.delete(oldestKey);
    }
  }

  responseCache.set(cacheKey, {
    payload: clonePayload(payload),
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

async function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (!cachedExecutablePath) {
    cachedExecutablePath = await chromium.executablePath();
  }

  if (!cachedExecutablePath) {
    throw new Error('Chromium executable path not available');
  }

  return cachedExecutablePath;
}

async function createBrowser() {
  ensureChromiumCacheDir();

  const executablePath = await resolveExecutablePath();

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-features=site-per-process,Translate',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-notifications',
      '--mute-audio',
      '--lang=en-US'
    ],
    defaultViewport: DEFAULT_VIEWPORT,
    executablePath,
    headless: chromium.headless !== undefined ? chromium.headless : true,
    ignoreHTTPSErrors: true
  });
}

async function preparePage(page, cookies) {
  await page.setUserAgent(DEFAULT_USER_AGENT);
  await page.setViewport(DEFAULT_VIEWPORT);
  await page.setJavaScriptEnabled(true);
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="122", "Not A(Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    referer: 'https://www.tiktok.com/'
  });

  if (cookies.length) {
    await page.setCookie(...cookies);
  }
}

function extractVideosFromApiResponses(responses) {
  const videos = [];

  for (const entry of responses) {
    const data = entry?.data;
    if (!data) {
      continue;
    }

    if (Array.isArray(data.itemList)) {
      videos.push(...data.itemList);
    }

    if (Array.isArray(data.aweme_list)) {
      videos.push(...data.aweme_list);
    }

    if (Array.isArray(data.item_list)) {
      videos.push(...data.item_list);
    }

    if (data.itemModule && typeof data.itemModule === 'object') {
      videos.push(...Object.values(data.itemModule));
    }
  }

  return videos;
}

async function extractSigiState(page) {
  try {
    return await page.evaluate(() => {
      if (typeof window === 'undefined') {
        return null;
      }
      const globalState = window.SIGI_STATE;
      if (!globalState) {
        return null;
      }
      return {
        itemModule: globalState.ItemModule || null,
        itemList: globalState.ItemList || null
      };
    });
  } catch {
    return null;
  }
}

function extractVideosFromSigiState(state) {
  if (!state) {
    return [];
  }

  const moduleValues =
    state.itemModule && typeof state.itemModule === 'object'
      ? Object.values(state.itemModule)
      : [];

  if (moduleValues.length) {
    return moduleValues;
  }

  if (state.itemList && typeof state.itemList === 'object' && state.itemModule) {
    const aggregated = [];
    Object.values(state.itemList).forEach((list) => {
      if (list && Array.isArray(list.list)) {
        list.list.forEach((id) => {
          if (state.itemModule[id]) {
            aggregated.push(state.itemModule[id]);
          }
        });
      }
    });
    if (aggregated.length) {
      return aggregated;
    }
  }

  return [];
}

async function extractVideosFromDom(page) {
  try {
    const scraped = await page.evaluate(() => {
      const items = [];
      const elements = document.querySelectorAll('[data-e2e="user-post-item"]');
      elements.forEach((element) => {
        const anchor = element.querySelector('a[href*="/video/"]');
        if (!anchor || !anchor.href) {
          return;
        }
        const descriptionNode = element.querySelector('[data-e2e="user-post-item-desc"]');
        items.push({
          videoUrl: anchor.href,
          description: descriptionNode ? descriptionNode.textContent || null : null
        });
      });
      return items;
    });

    return Array.isArray(scraped) ? scraped : [];
  } catch {
    return [];
  }
}

function extractVideoId(video) {
  if (!video) {
    return null;
  }

  if (typeof video.id === 'string' && video.id.trim()) {
    return video.id.trim();
  }

  if (typeof video.aweme_id === 'string' && video.aweme_id.trim()) {
    return video.aweme_id.trim();
  }

  if (video.video && typeof video.video.id === 'string' && video.video.id.trim()) {
    return video.video.id.trim();
  }

  if (typeof video.awemeId === 'string' && video.awemeId.trim()) {
    return video.awemeId.trim();
  }

  if (typeof video.videoUrl === 'string') {
    const match = video.videoUrl.match(/video\/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (typeof video.share_url === 'string') {
    const match = video.share_url.match(/video\/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

function resolveVideoUrl(video, username, videoId) {
  if (typeof video?.videoUrl === 'string' && video.videoUrl.startsWith('http')) {
    return video.videoUrl;
  }

  if (typeof video?.share_url === 'string' && video.share_url.startsWith('http')) {
    return video.share_url;
  }

  if (typeof video?.playUrl === 'string' && video.playUrl.startsWith('http')) {
    return video.playUrl;
  }

  if (videoId && typeof username === 'string') {
    return `https://www.tiktok.com/@${username.replace(/^@/, '')}/video/${videoId}`;
  }

  return null;
}

function extractDescription(video) {
  const value = video?.desc ?? video?.description ?? video?.title ?? null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function extractEpochTime(video) {
  const candidates = [
    video?.createTime,
    video?.create_time,
    video?.timestamp,
    video?.publishedTime,
    video?.itemInfos?.createTime,
    video?.statistics?.createTime
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const parsed = Number.parseInt(candidate, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function sanitizeStat(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(parsed, 0);
}

function extractStats(video) {
  const statsSource = video?.stats || video?.statistics || {};
  return {
    views: sanitizeStat(
      statsSource.playCount ?? statsSource.play_count ?? statsSource.viewCount ?? statsSource.view_count
    ),
    likes: sanitizeStat(statsSource.diggCount ?? statsSource.likeCount ?? statsSource.like_count),
    comments: sanitizeStat(statsSource.commentCount ?? statsSource.comment_count),
    shares: sanitizeStat(statsSource.shareCount ?? statsSource.share_count)
  };
}

function normalizeVideos(videos, username) {
  if (!Array.isArray(videos)) {
    return [];
  }

  const seenIds = new Set();
  const normalized = [];

  for (const rawVideo of videos) {
    const videoId = extractVideoId(rawVideo);
    const videoUrl = resolveVideoUrl(rawVideo, username, videoId);

    if (!videoId || !videoUrl) {
      continue;
    }

    if (seenIds.has(videoId)) {
      continue;
    }
    seenIds.add(videoId);

    normalized.push({
      video_id: videoId,
      url: videoUrl,
      description: extractDescription(rawVideo),
      epoch_time_posted: extractEpochTime(rawVideo),
      ...extractStats(rawVideo)
    });
  }

  return normalized;
}

function filterVideosByEpoch(videos, startEpoch, endEpoch) {
  const hasStart = typeof startEpoch === 'number';
  const hasEnd = typeof endEpoch === 'number';

  if (!hasStart && !hasEnd) {
    return videos;
  }

  return videos.filter((video) => {
    const epoch = video.epoch_time_posted;
    if (typeof epoch !== 'number') {
      return false;
    }
    if (hasStart && epoch < startEpoch) {
      return false;
    }
    if (hasEnd && epoch > endEpoch) {
      return false;
    }
    return true;
  });
}

async function detectProfileUnavailable(page) {
  try {
    return await page.evaluate(() => {
      const selectors = [
        '[data-e2e="browse-blank"]',
        '[data-e2e="empty-state"]',
        '.error-page',
        '.user-not-found'
      ];
      for (const selector of selectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      const bodyText = document.body?.innerText || '';
      return /couldn't find this account|no content yet|this account is private/i.test(bodyText);
    });
  } catch {
    return false;
  }
}

async function collectVideoData(page, username) {
  const apiResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (
      !url ||
      (!url.includes('/api/post/item_list/') &&
        !url.includes('/api/user/detail/') &&
        !url.includes('/aweme/v1/web/aweme/post/'))
    ) {
      return;
    }
    try {
      const data = await response.json();
      apiResponses.push({ url, data });
    } catch {
      // ignore non-JSON responses
    }
  });

  await page
    .goto(`https://www.tiktok.com/@${username}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    .catch(() => {
      // Continue even if navigation times out; partial content may still be available
    });

  try {
    await page.waitForSelector('[data-e2e="user-post-item"]', {
      timeout: Math.max(2000, NAVIGATION_TIMEOUT_MS / 2)
    });
  } catch {
    // proceed even if posts are not immediately visible
  }

  await delay(CONTENT_WAIT_MS);

  let videos = extractVideosFromApiResponses(apiResponses);

  if (!videos.length) {
    const sigiState = await extractSigiState(page);
    videos = extractVideosFromSigiState(sigiState);
  }

  if (!videos.length) {
    videos = await extractVideosFromDom(page);
  }

  return videos;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-TikTok-Cookie');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, X-TikTok-Cookie');

  const exposedHeaders = new Set(['Content-Type', 'Retry-After', 'X-Cache', 'X-Cache-Expires-In']);
  RATE_LIMIT_RULES.forEach((rule) => {
    exposedHeaders.add(`X-RateLimit-Limit-${rule.label}`);
    exposedHeaders.add(`X-RateLimit-Remaining-${rule.label}`);
    exposedHeaders.add(`X-RateLimit-Reset-${rule.label}`);
  });
  res.setHeader('Access-Control-Expose-Headers', Array.from(exposedHeaders).join(', '));

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'success' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', status: 'error', code: 405 });
  }

  const rateLimitResult = enforceRateLimit(req);
  applyResponseHeaders(res, rateLimitResult.headers);

  if (rateLimitResult.limited) {
    if (rateLimitResult.retryAfterSeconds) {
      res.setHeader('Retry-After', rateLimitResult.retryAfterSeconds);
    }
    return res.status(429).json({
      error: 'Rate limit exceeded',
      status: 'error',
      code: 429
    });
  }

  const usernameRaw = getQueryParam(req.query.username);
  if (typeof usernameRaw !== 'string' || !usernameRaw.trim()) {
    return res.status(400).json({
      error: 'Missing required parameter: username',
      status: 'error',
      code: 400
    });
  }
  const username = usernameRaw.replace(/^@/, '').trim();

  const pageParam = getQueryParam(req.query.page);
  const perPageParam = getQueryParam(req.query['per-page']);
  const startEpochParam = getQueryParam(req.query.start_epoch);
  const endEpochParam = getQueryParam(req.query.end_epoch);

  let pageNum;
  let perPageNum;
  let startEpoch;
  let endEpoch;

  try {
    pageNum = parseIntegerParameter(pageParam, { name: 'page', defaultValue: 1, min: 1 });
    perPageNum = parseIntegerParameter(perPageParam, { name: 'per-page', defaultValue: 10, min: 1, max: 100 });
    startEpoch = parseOptionalEpoch(startEpochParam, 'start_epoch');
    endEpoch = parseOptionalEpoch(endEpochParam, 'end_epoch');
  } catch (error) {
    return res.status(400).json({
      error: error.message,
      status: 'error',
      code: 400
    });
  }

  if (typeof startEpoch === 'number' && typeof endEpoch === 'number' && startEpoch > endEpoch) {
    return res.status(400).json({
      error: '`start_epoch` must be less than or equal to `end_epoch`',
      status: 'error',
      code: 400
    });
  }

  const cookies = getCookies(req);
  const cacheKey = createCacheKey({ username, page: pageNum, perPage: perPageNum, startEpoch, endEpoch, cookies });

  const cached = getCachedResponse(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Expires-In', cached.expiresInSeconds);
    return res.status(200).json(cached.payload);
  }

  res.setHeader('X-Cache', CACHE_ENABLED ? 'MISS' : 'DISABLED');

  let browser;
  let page;

  const missingCookies = cookies.length === 0;

  try {
    browser = await createBrowser();
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    await preparePage(page, cookies);

    const rawVideos = await collectVideoData(page, username);
    const normalizedVideos = normalizeVideos(rawVideos, username);
    const filteredVideos = filterVideosByEpoch(normalizedVideos, startEpoch, endEpoch);

    filteredVideos.sort((a, b) => {
      const aTime = typeof a.epoch_time_posted === 'number' ? a.epoch_time_posted : 0;
      const bTime = typeof b.epoch_time_posted === 'number' ? b.epoch_time_posted : 0;
      return bTime - aTime;
    });

    if (!filteredVideos.length) {
      const unavailable = await detectProfileUnavailable(page);
      if (unavailable) {
        return res.status(404).json({
          error: 'TikTok profile not found or has no public videos',
          status: 'error',
          code: 404
        });
      }
    }

    const totalPosts = filteredVideos.length;
    const totalPages = perPageNum > 0 ? Math.ceil(totalPosts / perPageNum) : 0;
    const startIndex = (pageNum - 1) * perPageNum;
    const paginatedVideos = filteredVideos.slice(startIndex, startIndex + perPageNum);

    const responsePayload = {
      meta: {
        username,
        page: pageNum,
        total_pages: totalPages,
        posts_per_page: perPageNum,
        total_posts: totalPosts,
        start_epoch: startEpoch,
        end_epoch: endEpoch,
        first_video_epoch: filteredVideos[0]?.epoch_time_posted ?? null,
        last_video_epoch: filteredVideos[filteredVideos.length - 1]?.epoch_time_posted ?? null,
        request_time: Math.floor(Date.now() / 1000),
        cache_status: res.getHeader('X-Cache')
      },
      data: paginatedVideos,
      status: 'success'
    };

    storeCachedResponse(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('TikTok handler error:', error);

    let statusCode = 500;
    let message = 'Unexpected error while processing the request';

    const loweredMessage = error.message.toLowerCase();

    const hints = [];

    if (missingCookies) {
      hints.push(
        'No TikTok cookies detected. Supply session cookies via the X-TikTok-Cookie header or TIKTOK_COOKIE environment variable for reliable access.'
      );
    }

    if (/timeout/i.test(error.message)) {
      statusCode = 504;
      message = 'Timed out while loading TikTok. Please retry.';
      hints.push('TikTok can be slow to respond—retry with a smaller per-page value or later in time.');
    } else if (/executable path not available/i.test(error.message)) {
      statusCode = 503;
      message = 'Chromium executable not available in the current environment.';
      hints.push('Verify that @sparticuz/chromium is installed and Vercel functions are allowed to download Chromium.');
    } else if (loweredMessage.includes('failed to launch the browser process')) {
      statusCode = 503;
      message = 'Failed to launch Chromium in the Vercel environment.';
      hints.push(
        'Clear the function cache and redeploy so @sparticuz/chromium can download a fresh binary.'
      );
      hints.push('Confirm PUPPETEER_CACHE_DIR points to a writable location (default /tmp/chromium-cache).');
    } else if (
      loweredMessage.includes('target closed') ||
      loweredMessage.includes('execution context was destroyed') ||
      loweredMessage.includes('navigation failed because browser has disconnected')
    ) {
      statusCode = 503;
      message =
        'TikTok blocked the automated browser. Provide valid session cookies via X-TikTok-Cookie header or environment variable.';
      hints.push('TikTok often blocks anonymous scraping. Re-use cookies from an authenticated browser session.');
    } else if (loweredMessage.includes('too many requests') || loweredMessage.includes('429')) {
      statusCode = 429;
      message = 'TikTok rate limited the request. Please wait before retrying.';
      hints.push('Implement exponential backoff and avoid sending requests more frequently than once every few seconds.');
    } else if (loweredMessage.includes('net::err_http_response_code_failure')) {
      statusCode = 502;
      message =
        'TikTok refused the request. Provide valid TikTok cookies or verify the profile is accessible from your region.';
      hints.push('If the profile is geo-restricted, route traffic through a region where it is accessible.');
    } else if (statusCode === 500 && error.message) {
      const sanitized = error.message.split('\n')[0];
      message = `Unexpected error while processing the request: ${sanitized}`;
    }

    const errorResponse = {
      error: message,
      status: 'error',
      code: statusCode
    };

    if (hints.length) {
      errorResponse.hints = hints;
    }

    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.stack;
    }

    return res.status(statusCode).json(errorResponse);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.warn('Failed to close page cleanly:', closeError);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.warn('Failed to close browser cleanly:', closeError);
      }
    }
  }
}
