import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
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

const HTTP_FETCH_TIMEOUT_MS = normalizeInteger(process.env.HTTP_FETCH_TIMEOUT_MS, 12_000);
const HTTP_MAX_RETRIES = Math.max(normalizeInteger(process.env.HTTP_MAX_RETRIES, 3), 1);
const HTTP_ITEM_LIST_PAGE_SIZE = (() => {
  const raw = normalizeInteger(process.env.YOUTUBE_ITEM_LIST_PAGE_SIZE, 30);
  if (Number.isNaN(raw)) {
    return 30;
  }
  return Math.min(Math.max(raw, 1), 50);
})();
const HTTP_ITEM_LIST_MAX_PAGES = Math.max(normalizeInteger(process.env.YOUTUBE_ITEM_LIST_MAX_PAGES, 40), 1);
const HTTP_ITEM_LIST_BUFFER_PAGES = Math.max(normalizeInteger(process.env.YOUTUBE_ITEM_LIST_BUFFER_PAGES, 2), 1);

const RATE_LIMIT_RULES = buildRateLimitRules();
const rateLimitState = new Map();
const responseCache = new Map();

let cachedExecutablePath;

const DEFAULT_CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar';
const CHROMIUM_SOURCE =
  process.env.CHROMIUM_BINARIES_PATH || process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL;

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

function normalizeCookiesFromString(rawCookie, domain = '.youtube.com') {
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
      domain,
      path: '/'
    }));
}

function normalizeCookiesFromJson(rawCookie, domain = '.youtube.com') {
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
        domain: cookie.domain || domain,
        path: cookie.path || '/',
        expires: cookie.expires
      }));
  } catch {
    return [];
  }
}

function normalizeCookieInput(rawCookie, domain = '.youtube.com') {
  if (!rawCookie) {
    return [];
  }
  const trimmed = rawCookie.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const cookies = normalizeCookiesFromJson(trimmed, domain);
    if (cookies.length) {
      return cookies;
    }
  }
  return normalizeCookiesFromString(trimmed, domain);
}

function decodeCookieHeader(rawHeader, domain = '.youtube.com') {
  if (!rawHeader) {
    return [];
  }
  let decoded = rawHeader;
  try {
    decoded = Buffer.from(rawHeader, 'base64').toString('utf-8');
  } catch {
    decoded = rawHeader;
  }
  return normalizeCookieInput(decoded, domain);
}

function getCookies(req) {
  const cookies = [];

  const headerValue = req.headers['x-youtube-cookie'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    cookies.push(...decodeCookieHeader(headerValue.trim()));
  }

  if (!cookies.length && process.env.YOUTUBE_COOKIE) {
    cookies.push(...normalizeCookieInput(process.env.YOUTUBE_COOKIE));
  }

  if (!cookies.length) {
    const fallbackCookies = [
      { name: 'CONSENT', value: process.env.YOUTUBE_CONSENT },
      { name: 'VISITOR_INFO1_LIVE', value: process.env.YOUTUBE_VISITOR_INFO }
    ].filter((cookie) => typeof cookie.value === 'string' && cookie.value.trim().length > 0);

    cookies.push(
      ...fallbackCookies.map((cookie) => ({
        ...cookie,
        domain: '.youtube.com',
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
      domain: cookie.domain || '.youtube.com',
      path: cookie.path || '/'
    });
  }

  return unique;
}

function createCookieMap(initialCookies = []) {
  const map = new Map();
  if (Array.isArray(initialCookies)) {
    initialCookies.forEach((cookie) => {
      if (cookie && cookie.name && cookie.value) {
        map.set(cookie.name.trim(), cookie.value.trim());
      }
    });
  }
  return map;
}

function serializeCookieMap(cookieMap) {
  if (!(cookieMap instanceof Map) || cookieMap.size === 0) {
    return '';
  }
  const segments = [];
  cookieMap.forEach((value, name) => {
    if (name && value) {
      segments.push(`${name}=${value}`);
    }
  });
  return segments.join('; ');
}

function applySetCookieHeaders(cookieMap, setCookieHeaders) {
  if (!(cookieMap instanceof Map) || !Array.isArray(setCookieHeaders)) {
    return;
  }
  setCookieHeaders.forEach((header) => {
    if (typeof header !== 'string' || !header.trim()) {
      return;
    }
    const [pair] = header.split(';');
    const [rawName, ...rest] = pair.split('=');
    const name = rawName?.trim();
    const value = rest.join('=').trim();
    if (name && value) {
      cookieMap.set(name, value);
    }
  });
}

function buildHtmlRequestHeaders({ cookieHeader, referer } = {}) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not A(Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': DEFAULT_USER_AGENT
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  if (referer) {
    headers.Referer = referer;
  }

  return headers;
}

function buildApiRequestHeaders({ cookieHeader, referer } = {}) {
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    Origin: 'https://www.youtube.com',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not A(Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': DEFAULT_USER_AGENT,
    'X-Goog-Visitor-Id': 'CgtTdEVqaE5Db2hqSSjzzOGvBg%3D%3D',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': '2.20240101.00.00'
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  if (referer) {
    headers.Referer = referer;
  }

  return headers;
}

function extractYtInitialDataFromHtml(html) {
  if (typeof html !== 'string' || !html.includes('var ytInitialData')) {
    throw new Error('YouTube channel page did not contain expected ytInitialData script');
  }
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error('Unable to locate ytInitialData in YouTube channel page');
  }
  const end = html.indexOf(';</script>', start);
  if (end === -1) {
    throw new Error('Incomplete ytInitialData payload detected on YouTube channel page');
  }
  const payload = html.slice(start + marker.length, end);
  return JSON.parse(payload);
}

function extractChannelInfoFromYtInitialData(ytInitialData, channelHandle) {
  const tabs = ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find(tab => tab.tabRenderer?.title === 'Videos' || tab.tabRenderer?.selected);

  const channelInfo = {
    channelId: ytInitialData?.metadata?.channelMetadataRenderer?.externalId,
    title: ytInitialData?.metadata?.channelMetadataRenderer?.title,
    description: ytInitialData?.metadata?.channelMetadataRenderer?.description,
    subscriberCount: null,
    videoCount: null
  };

  if (!channelInfo.channelId) {
    throw new Error(`Unable to resolve channel information for ${channelHandle}`);
  }

  const header = ytInitialData?.header?.c4TabbedHeaderRenderer || ytInitialData?.header?.pageHeaderRenderer;
  if (header?.subscriberCountText?.simpleText) {
    channelInfo.subscriberCount = header.subscriberCountText.simpleText;
  }

  return { channelInfo, videosTab };
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

function createCacheKey({ channelHandle, page, perPage, startEpoch, endEpoch, cookies }) {
  const normalizedHandle = channelHandle.toLowerCase();
  const base = [normalizedHandle, page, perPage, startEpoch ?? '', endEpoch ?? ''].join('::');

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

async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = HTTP_FETCH_TIMEOUT_MS,
    maxAttempts = HTTP_MAX_RETRIES,
    retryOn = [429, 500, 502, 503, 504],
    ...fetchOptions
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    attempt += 1;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutHandle);

      if (retryOn.includes(response.status) && attempt < maxAttempts) {
        await delay(200 * attempt);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutHandle);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxAttempts) {
        break;
      }
      await delay(200 * attempt);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function fetchChannelMetadataHttp({ channelHandle, cookieMap }) {
  const channelUrl = `https://www.youtube.com/${channelHandle}/videos`;
  let attempt = 0;
  let lastError;

  while (attempt < 2) {
    attempt += 1;
    const cookieHeader = serializeCookieMap(cookieMap);
    const headers = buildHtmlRequestHeaders({ cookieHeader, referer: 'https://www.youtube.com/' });
    const response = await fetchWithRetry(channelUrl, {
      headers,
      redirect: 'follow',
      timeoutMs: HTTP_FETCH_TIMEOUT_MS
    });

    const setCookieValues =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    applySetCookieHeaders(cookieMap, setCookieValues);

    const status = response.status;
    const html = await response.text();

    if (status === 404) {
      const error = new Error(`YouTube channel "${channelHandle}" not found or has no public videos`);
      error.code = 'CHANNEL_NOT_FOUND';
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`Failed to load YouTube channel page (status ${status})`);
      error.code = 'CHANNEL_HTTP_ERROR';
      throw error;
    }

    try {
      const ytInitialData = extractYtInitialDataFromHtml(html);
      const { channelInfo, videosTab } = extractChannelInfoFromYtInitialData(ytInitialData, channelHandle);
      return { channelInfo, videosTab, html };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 2) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error(`Failed to load YouTube channel "${channelHandle}"`);
}

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (!cachedExecutablePath) {
    cachedExecutablePath = chromium.executablePath(CHROMIUM_SOURCE);
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
    referer: 'https://www.youtube.com/'
  });

  if (cookies.length) {
    await page.setCookie(...cookies);
  }
}

function extractVideoId(video) {
  if (!video) {
    return null;
  }

  if (typeof video.videoId === 'string' && video.videoId.trim()) {
    return video.videoId.trim();
  }

  if (typeof video.id === 'string' && video.id.trim()) {
    return video.id.trim();
  }

  return null;
}

function resolveVideoUrl(video, videoId) {
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  return null;
}

function extractTitle(video) {
  const runs = video?.title?.runs || [];
  if (runs.length > 0 && runs[0].text) {
    return runs[0].text.trim();
  }

  if (typeof video?.title?.simpleText === 'string') {
    return video.title.simpleText.trim();
  }

  if (typeof video?.title === 'string') {
    return video.title.trim();
  }

  return null;
}

function extractDescription(video) {
  const runs = video?.descriptionSnippet?.runs || [];
  if (runs.length > 0) {
    return runs.map(run => run.text).join('').trim();
  }

  if (typeof video?.description === 'string') {
    return video.description.trim();
  }

  return null;
}

function parseViewCount(text) {
  if (!text) return null;

  const match = text.match(/([\d,\.]+)\s*(K|M|B)?/i);
  if (!match) return null;

  const number = parseFloat(match[1].replace(/,/g, ''));
  const multiplier = match[2]?.toUpperCase();

  let value = number;
  if (multiplier === 'K') value *= 1000;
  else if (multiplier === 'M') value *= 1000000;
  else if (multiplier === 'B') value *= 1000000000;

  return Math.floor(value);
}

function parseTimeAgo(text) {
  if (!text) return null;

  const now = Math.floor(Date.now() / 1000);
  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);

  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  const secondsPerUnit = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000
  };

  const seconds = value * (secondsPerUnit[unit] || 0);
  return now - seconds;
}

function extractEpochTime(video) {
  if (video?.publishedTimeText?.simpleText) {
    return parseTimeAgo(video.publishedTimeText.simpleText);
  }

  const runs = video?.publishedTimeText?.runs || [];
  if (runs.length > 0 && runs[0].text) {
    return parseTimeAgo(runs[0].text);
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
  let views = null;

  if (video?.viewCountText?.simpleText) {
    views = parseViewCount(video.viewCountText.simpleText);
  } else if (video?.viewCountText?.runs?.[0]?.text) {
    views = parseViewCount(video.viewCountText.runs[0].text);
  }

  return {
    views: sanitizeStat(views),
    likes: null,
    comments: null
  };
}

function normalizeVideos(videos, channelHandle) {
  if (!Array.isArray(videos)) {
    return [];
  }

  const seenIds = new Set();
  const normalized = [];

  for (const rawVideo of videos) {
    const video = rawVideo?.gridVideoRenderer || rawVideo?.videoRenderer || rawVideo;
    const videoId = extractVideoId(video);
    const videoUrl = resolveVideoUrl(video, videoId);

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
      title: extractTitle(video),
      description: extractDescription(video),
      epoch_time_posted: extractEpochTime(video),
      ...extractStats(video)
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

async function collectVideoDataViaBrowser(page, channelHandle, options = {}) {
  const {
    targetItems = 50,
    startEpoch = null,
    endEpoch = null
  } = options;

  await page
    .goto(`https://www.youtube.com/${channelHandle}/videos`, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    .catch(() => {});

  await delay(CONTENT_WAIT_MS);

  let videos = [];
  let channelInfo = null;

  try {
    const extractedData = await page.evaluate(() => {
      const ytInitialData = window.ytInitialData;
      const tabs = ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const videosTab = tabs.find(tab => tab.tabRenderer?.title === 'Videos' || tab.tabRenderer?.selected);

      const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
      const videoItems = contents
        .filter(item => item.richItemRenderer?.content?.videoRenderer)
        .map(item => item.richItemRenderer.content.videoRenderer);

      return {
        videos: videoItems,
        channelInfo: {
          channelId: ytInitialData?.metadata?.channelMetadataRenderer?.externalId,
          title: ytInitialData?.metadata?.channelMetadataRenderer?.title,
          description: ytInitialData?.metadata?.channelMetadataRenderer?.description
        }
      };
    });

    videos = extractedData.videos;
    channelInfo = extractedData.channelInfo;

    let scrollAttempts = 0;
    const maxScrolls = 10;

    while (videos.length < targetItems && scrollAttempts < maxScrolls) {
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });

      await delay(2000);

      const newData = await page.evaluate(() => {
        const ytInitialData = window.ytInitialData;
        const tabs = ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const videosTab = tabs.find(tab => tab.tabRenderer?.title === 'Videos' || tab.tabRenderer?.selected);

        const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
        const videoItems = contents
          .filter(item => item.richItemRenderer?.content?.videoRenderer)
          .map(item => item.richItemRenderer.content.videoRenderer);

        return videoItems;
      });

      if (newData.length === videos.length) {
        break;
      }

      videos = newData;
      scrollAttempts++;
    }
  } catch (error) {
    console.warn('Failed to extract YouTube videos via browser:', error);
  }

  return { videos, channelInfo };
}

async function fetchVideosViaHttp({ channelHandle, cookies, pageNum, perPageNum, startEpoch, endEpoch }) {
  const cookieMap = createCookieMap(cookies);

  let channelResult;
  let channelInfo;
  let videosTab;

  try {
    channelResult = await fetchChannelMetadataHttp({ channelHandle, cookieMap });
    channelInfo = channelResult.channelInfo;
    videosTab = channelResult.videosTab;
  } catch (error) {
    throw error;
  }

  const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
  const allVideos = contents
    .filter(item => item.richItemRenderer?.content?.videoRenderer)
    .map(item => item.richItemRenderer.content.videoRenderer);

  const normalizedVideos = normalizeVideos(allVideos, channelHandle);
  normalizedVideos.sort((a, b) => {
    const aTime = typeof a.epoch_time_posted === 'number' ? a.epoch_time_posted : 0;
    const bTime = typeof b.epoch_time_posted === 'number' ? b.epoch_time_posted : 0;
    return bTime - aTime;
  });

  return {
    videos: normalizedVideos,
    channelInfo: channelInfo,
    diagnostics: {
      source: 'http',
      fetched_items: normalizedVideos.length
    }
  };
}

function resolveTotalVideoCount(channelInfo) {
  if (!channelInfo) {
    return null;
  }
  const candidates = [
    channelInfo.videoCount,
    channelInfo.video_count
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const parsed = Number.parseInt(candidate, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Youtube-Cookie');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, X-Youtube-Cookie');

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

  const channelHandleRaw = getQueryParam(req.query.channel);
  if (typeof channelHandleRaw !== 'string' || !channelHandleRaw.trim()) {
    return res.status(400).json({
      error: 'Missing required parameter: channel',
      status: 'error',
      code: 400
    });
  }
  const channelHandle = channelHandleRaw.startsWith('@') ? channelHandleRaw.trim() : `@${channelHandleRaw.trim()}`;

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
  const cacheKey = createCacheKey({ channelHandle, page: pageNum, perPage: perPageNum, startEpoch, endEpoch, cookies });

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
    let fetchContext = null;
    let httpError = null;

    try {
      fetchContext = await fetchVideosViaHttp({
        channelHandle,
        cookies,
        pageNum,
        perPageNum,
        startEpoch,
        endEpoch
      });
    } catch (error) {
      httpError = error instanceof Error ? error : new Error(String(error));
      console.warn('Primary HTTP fetch failed, attempting browser fallback:', httpError);
    }

    if (httpError?.code === 'CHANNEL_NOT_FOUND') {
      return res.status(404).json({
        error: 'YouTube channel not found or has no public videos',
        status: 'error',
        code: 404
      });
    }

    if (!fetchContext) {
      browser = await createBrowser();
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

      await preparePage(page, cookies);

      const targetCount = Math.max(pageNum * perPageNum, perPageNum);
      const { videos: rawVideos, channelInfo } = await collectVideoDataViaBrowser(page, channelHandle, {
        targetItems: targetCount,
        startEpoch,
        endEpoch
      });

      const normalizedVideos = normalizeVideos(rawVideos, channelHandle);
      normalizedVideos.sort((a, b) => {
        const aTime = typeof a.epoch_time_posted === 'number' ? a.epoch_time_posted : 0;
        const bTime = typeof b.epoch_time_posted === 'number' ? b.epoch_time_posted : 0;
        return bTime - aTime;
      });

      fetchContext = {
        videos: normalizedVideos,
        channelInfo: channelInfo ?? null,
        diagnostics: {
          source: 'browser',
          http_error_code: httpError?.code ?? null,
          http_error_message: httpError ? httpError.message : null
        }
      };
    }

    if (!fetchContext || !Array.isArray(fetchContext.videos)) {
      throw new Error('Unable to retrieve YouTube videos with available methods');
    }

    const normalizedVideos = fetchContext.videos;
    const channelInfo = fetchContext.channelInfo ?? null;
    const diagnostics = fetchContext.diagnostics ?? {};

    const filteredVideos = filterVideosByEpoch(normalizedVideos, startEpoch, endEpoch);

    const totalVideos = filteredVideos.length;
    const totalPages = perPageNum > 0 ? Math.ceil(totalVideos / perPageNum) : 0;
    const startIndex = (pageNum - 1) * perPageNum;
    const paginatedVideos = filteredVideos.slice(startIndex, startIndex + perPageNum);

    const channelTotalVideos = resolveTotalVideoCount(channelInfo);

    const responsePayload = {
      meta: {
        channel: channelHandle,
        page: pageNum,
        total_pages: totalPages,
        videos_per_page: perPageNum,
        total_videos: totalVideos,
        channel_total_videos: typeof channelTotalVideos === 'number' ? channelTotalVideos : totalVideos,
        fetched_videos: normalizedVideos.length,
        start_epoch: startEpoch,
        end_epoch: endEpoch,
        first_video_epoch: filteredVideos[0]?.epoch_time_posted ?? null,
        last_video_epoch: filteredVideos[filteredVideos.length - 1]?.epoch_time_posted ?? null,
        request_time: Math.floor(Date.now() / 1000),
        cache_status: res.getHeader('X-Cache'),
        fetch_method: diagnostics.source
      },
      data: paginatedVideos,
      status: 'success'
    };

    if (diagnostics.http_error_message || diagnostics.http_error_code) {
      responsePayload.meta.http_fallback_reason = diagnostics.http_error_message ?? diagnostics.http_error_code;
    }

    storeCachedResponse(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('YouTube handler error:', error);

    let statusCode = 500;
    let message = 'Unexpected error while processing the request';

    const loweredMessage = error.message.toLowerCase();

    const hints = [];

    if (missingCookies) {
      hints.push(
        'No YouTube cookies detected. Supply session cookies via the X-Youtube-Cookie header or YOUTUBE_COOKIE environment variable for reliable access.'
      );
    }

    if (/timeout/i.test(error.message)) {
      statusCode = 504;
      message = 'Timed out while loading YouTube. Please retry.';
      hints.push('YouTube can be slow to respond—retry with a smaller per-page value or later in time.');
    } else if (/executable path not available/i.test(error.message)) {
      statusCode = 503;
      message = 'Chromium executable not available in the current environment.';
      hints.push(
        'Verify that @sparticuz/chromium is installed and the Chromium binary can be downloaded from GitHub releases.'
      );
    } else if (loweredMessage.includes('failed to launch the browser process')) {
      statusCode = 503;
      message = 'Failed to launch Chromium in the Vercel environment.';
      hints.push(
        'Ensure the Brotli pack is reachable (CHROMIUM_PACK_URL) and redeploy without cache so Chromium can unpack again.'
      );
      hints.push('Confirm PUPPETEER_CACHE_DIR points to a writable location (default /tmp/chromium-cache).');
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
