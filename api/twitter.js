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
  const raw = normalizeInteger(process.env.TWITTER_ITEM_LIST_PAGE_SIZE, 20);
  if (Number.isNaN(raw)) {
    return 20;
  }
  return Math.min(Math.max(raw, 1), 100);
})();
const HTTP_ITEM_LIST_MAX_PAGES = Math.max(normalizeInteger(process.env.TWITTER_ITEM_LIST_MAX_PAGES, 40), 1);
const HTTP_ITEM_LIST_BUFFER_PAGES = Math.max(normalizeInteger(process.env.TWITTER_ITEM_LIST_BUFFER_PAGES, 2), 1);

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

function normalizeCookiesFromString(rawCookie, domain = '.x.com') {
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

function normalizeCookiesFromJson(rawCookie, domain = '.x.com') {
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

function normalizeCookieInput(rawCookie, domain = '.x.com') {
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

function decodeCookieHeader(rawHeader, domain = '.x.com') {
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

  const headerValue = req.headers['x-twitter-cookie'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    cookies.push(...decodeCookieHeader(headerValue.trim()));
  }

  if (!cookies.length && process.env.TWITTER_COOKIE) {
    cookies.push(...normalizeCookieInput(process.env.TWITTER_COOKIE));
  }

  if (!cookies.length) {
    const fallbackCookies = [
      { name: 'auth_token', value: process.env.TWITTER_AUTH_TOKEN },
      { name: 'ct0', value: process.env.TWITTER_CT0 }
    ].filter((cookie) => typeof cookie.value === 'string' && cookie.value.trim().length > 0);

    cookies.push(
      ...fallbackCookies.map((cookie) => ({
        ...cookie,
        domain: '.x.com',
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
      domain: cookie.domain || '.x.com',
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

function buildHtmlRequestHeaders({ cookieHeader, referer, csrfToken } = {}) {
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

  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }

  return headers;
}

function buildApiRequestHeaders({ cookieHeader, referer, csrfToken, bearerToken } = {}) {
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    Authorization: bearerToken || 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    Origin: 'https://x.com',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not A(Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': DEFAULT_USER_AGENT,
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Client-Language': 'en'
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  if (referer) {
    headers.Referer = referer;
  }

  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }

  return headers;
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

async function fetchProfileMetadataHttp({ username, cookieMap }) {
  const profileUrl = `https://x.com/${username}`;
  let attempt = 0;
  let lastError;

  while (attempt < 2) {
    attempt += 1;
    const cookieHeader = serializeCookieMap(cookieMap);
    const headers = buildHtmlRequestHeaders({ cookieHeader, referer: 'https://x.com/' });
    const response = await fetchWithRetry(profileUrl, {
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
      const error = new Error(`Twitter/X profile "${username}" not found or is private`);
      error.code = 'PROFILE_NOT_FOUND';
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`Failed to load Twitter/X profile page (status ${status})`);
      error.code = 'PROFILE_HTTP_ERROR';
      throw error;
    }

    return { html };
  }

  throw lastError ?? new Error(`Failed to load Twitter/X profile "${username}"`);
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
    referer: 'https://x.com/'
  });

  if (cookies.length) {
    await page.setCookie(...cookies);
  }
}

function extractTweetId(tweet) {
  if (!tweet) {
    return null;
  }

  if (typeof tweet.rest_id === 'string' && tweet.rest_id.trim()) {
    return tweet.rest_id.trim();
  }

  if (typeof tweet.id_str === 'string' && tweet.id_str.trim()) {
    return tweet.id_str.trim();
  }

  if (typeof tweet.id === 'string' && tweet.id.trim()) {
    return tweet.id.trim();
  }

  return null;
}

function resolveTweetUrl(tweet, username, tweetId) {
  if (tweetId && typeof username === 'string') {
    return `https://x.com/${username.replace(/^@/, '')}/status/${tweetId}`;
  }

  return null;
}

function extractText(tweet) {
  const legacy = tweet?.legacy || tweet;
  const text = legacy?.full_text || legacy?.text || null;

  if (typeof text === 'string') {
    const trimmed = text.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function extractEpochTime(tweet) {
  const legacy = tweet?.legacy || tweet;
  const createdAt = legacy?.created_at;

  if (typeof createdAt === 'string') {
    try {
      const date = new Date(createdAt);
      return Math.floor(date.getTime() / 1000);
    } catch {
      return null;
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

function extractStats(tweet) {
  const legacy = tweet?.legacy || tweet;

  return {
    retweets: sanitizeStat(legacy?.retweet_count),
    likes: sanitizeStat(legacy?.favorite_count),
    replies: sanitizeStat(legacy?.reply_count),
    views: sanitizeStat(tweet?.views?.count)
  };
}

function normalizeTweets(tweets, username) {
  if (!Array.isArray(tweets)) {
    return [];
  }

  const seenIds = new Set();
  const normalized = [];

  for (const rawTweet of tweets) {
    const tweet = rawTweet?.tweet || rawTweet;
    const tweetId = extractTweetId(tweet);
    const tweetUrl = resolveTweetUrl(tweet, username, tweetId);

    if (!tweetId || !tweetUrl) {
      continue;
    }

    if (seenIds.has(tweetId)) {
      continue;
    }
    seenIds.add(tweetId);

    normalized.push({
      tweet_id: tweetId,
      url: tweetUrl,
      text: extractText(tweet),
      epoch_time_posted: extractEpochTime(tweet),
      ...extractStats(tweet)
    });
  }

  return normalized;
}

function filterTweetsByEpoch(tweets, startEpoch, endEpoch) {
  const hasStart = typeof startEpoch === 'number';
  const hasEnd = typeof endEpoch === 'number';

  if (!hasStart && !hasEnd) {
    return tweets;
  }

  return tweets.filter((tweet) => {
    const epoch = tweet.epoch_time_posted;
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

async function collectTweetDataViaBrowser(page, username, options = {}) {
  const {
    targetItems = 50,
    startEpoch = null,
    endEpoch = null
  } = options;

  await page
    .goto(`https://x.com/${username}`, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    .catch(() => {});

  await delay(CONTENT_WAIT_MS);

  let tweets = [];
  let profileInfo = null;

  try {
    let scrollAttempts = 0;
    const maxScrolls = 10;

    while (tweets.length < targetItems && scrollAttempts < maxScrolls) {
      const extractedData = await page.evaluate(() => {
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

        return articles.map(article => {
          const timeElement = article.querySelector('time');
          const textElement = article.querySelector('[data-testid="tweetText"]');
          const linkElement = article.querySelector('a[href*="/status/"]');

          let tweetId = null;
          if (linkElement && linkElement.href) {
            const match = linkElement.href.match(/status\/(\d+)/);
            if (match) tweetId = match[1];
          }

          return {
            rest_id: tweetId,
            legacy: {
              created_at: timeElement?.getAttribute('datetime'),
              full_text: textElement?.textContent
            }
          };
        }).filter(tweet => tweet.rest_id);
      });

      tweets = extractedData;

      if (tweets.length >= targetItems) {
        break;
      }

      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });

      await delay(2000);
      scrollAttempts++;
    }
  } catch (error) {
    console.warn('Failed to extract tweets via browser:', error);
  }

  return { tweets, profileInfo };
}

async function fetchTweetsViaHttp({ username, cookies, pageNum, perPageNum, startEpoch, endEpoch }) {
  const cookieMap = createCookieMap(cookies);

  let profileResult;

  try {
    profileResult = await fetchProfileMetadataHttp({ username, cookieMap });
  } catch (error) {
    throw error;
  }

  const tweets = [];

  return {
    tweets: [],
    profileInfo: null,
    diagnostics: {
      source: 'http',
      fetched_items: 0
    }
  };
}

function resolveTotalTweetCount(profileInfo) {
  if (!profileInfo) {
    return null;
  }
  const candidates = [
    profileInfo.statuses_count,
    profileInfo.tweets_count
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Twitter-Cookie');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, X-Twitter-Cookie');

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
    let fetchContext = null;
    let httpError = null;

    try {
      fetchContext = await fetchTweetsViaHttp({
        username,
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

    if (httpError?.code === 'PROFILE_NOT_FOUND') {
      return res.status(404).json({
        error: 'Twitter/X profile not found or is private',
        status: 'error',
        code: 404
      });
    }

    if (!fetchContext || fetchContext.tweets.length === 0) {
      browser = await createBrowser();
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

      await preparePage(page, cookies);

      const targetCount = Math.max(pageNum * perPageNum, perPageNum);
      const { tweets: rawTweets, profileInfo } = await collectTweetDataViaBrowser(page, username, {
        targetItems: targetCount,
        startEpoch,
        endEpoch
      });

      const normalizedTweets = normalizeTweets(rawTweets, username);
      normalizedTweets.sort((a, b) => {
        const aTime = typeof a.epoch_time_posted === 'number' ? a.epoch_time_posted : 0;
        const bTime = typeof b.epoch_time_posted === 'number' ? b.epoch_time_posted : 0;
        return bTime - aTime;
      });

      fetchContext = {
        tweets: normalizedTweets,
        profileInfo: profileInfo ?? null,
        diagnostics: {
          source: 'browser',
          http_error_code: httpError?.code ?? null,
          http_error_message: httpError ? httpError.message : null
        }
      };
    }

    if (!fetchContext || !Array.isArray(fetchContext.tweets)) {
      throw new Error('Unable to retrieve Twitter/X tweets with available methods');
    }

    const normalizedTweets = fetchContext.tweets;
    const profileInfo = fetchContext.profileInfo ?? null;
    const diagnostics = fetchContext.diagnostics ?? {};

    const filteredTweets = filterTweetsByEpoch(normalizedTweets, startEpoch, endEpoch);

    const totalTweets = filteredTweets.length;
    const totalPages = perPageNum > 0 ? Math.ceil(totalTweets / perPageNum) : 0;
    const startIndex = (pageNum - 1) * perPageNum;
    const paginatedTweets = filteredTweets.slice(startIndex, startIndex + perPageNum);

    const profileTotalTweets = resolveTotalTweetCount(profileInfo);

    const responsePayload = {
      meta: {
        username,
        page: pageNum,
        total_pages: totalPages,
        tweets_per_page: perPageNum,
        total_tweets: totalTweets,
        profile_total_tweets: typeof profileTotalTweets === 'number' ? profileTotalTweets : totalTweets,
        fetched_tweets: normalizedTweets.length,
        start_epoch: startEpoch,
        end_epoch: endEpoch,
        first_tweet_epoch: filteredTweets[0]?.epoch_time_posted ?? null,
        last_tweet_epoch: filteredTweets[filteredTweets.length - 1]?.epoch_time_posted ?? null,
        request_time: Math.floor(Date.now() / 1000),
        cache_status: res.getHeader('X-Cache'),
        fetch_method: diagnostics.source
      },
      data: paginatedTweets,
      status: 'success'
    };

    if (diagnostics.http_error_message || diagnostics.http_error_code) {
      responsePayload.meta.http_fallback_reason = diagnostics.http_error_message ?? diagnostics.http_error_code;
    }

    storeCachedResponse(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Twitter/X handler error:', error);

    let statusCode = 500;
    let message = 'Unexpected error while processing the request';

    const loweredMessage = error.message.toLowerCase();

    const hints = [];

    if (missingCookies) {
      hints.push(
        'No Twitter/X cookies detected. Supply session cookies via the X-Twitter-Cookie header or TWITTER_COOKIE environment variable for reliable access.'
      );
    }

    if (/timeout/i.test(error.message)) {
      statusCode = 504;
      message = 'Timed out while loading Twitter/X. Please retry.';
      hints.push('Twitter/X can be slow to respond—retry with a smaller per-page value or later in time.');
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
