// api/bio.js - Vercel Serverless Function to get TikTok user bio
import { createHash } from 'crypto';
import { requireApiKey } from '../lib/auth.js';

const CACHE_TTL_MS = 300000; // 5 minutes
const CACHE_MAX_ENTRIES = 100;
const responseCache = new Map();

function getCookies(req) {
  const headerCookie = req.headers['x-tiktok-cookie'];
  const envCookie = process.env.TIKTOK_COOKIE;
  const rawCookie = headerCookie || envCookie || '';

  if (!rawCookie) {
    return [];
  }

  return rawCookie.split(';').map((c) => {
    const [name, ...valueParts] = c.trim().split('=');
    return {
      name,
      value: valueParts.join('='),
      domain: '.tiktok.com',
      path: '/',
      httpOnly: true,
      secure: true
    };
  });
}

function createCacheKey(username, cookies) {
  const base = `bio:${username}`;
  if (!cookies.length) {
    return base;
  }
  const sortedCookies = cookies
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join('|');
  const cookieHash = createHash('sha256').update(sortedCookies).digest('hex');
  return `${base}::${cookieHash}`;
}

function getCachedResponse(cacheKey) {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function storeCachedResponse(cacheKey, payload) {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function extractUniversalDataFromHtml(html) {
  if (typeof html !== 'string' || !html.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__')) {
    throw new Error('TikTok profile page did not contain expected universal data script tag');
  }
  const marker = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error('Unable to locate universal data payload');
  }
  const end = html.indexOf('</script>', start);
  if (end === -1) {
    throw new Error('Incomplete universal data payload detected');
  }
  const payload = html.slice(start + marker.length, end);
  return JSON.parse(payload);
}

async function fetchBio(username, cookies) {
  const profileUrl = `https://www.tiktok.com/@${username}`;
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/'
  };

  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const response = await fetch(profileUrl, { headers });
  
  if (response.status === 404) {
    const error = new Error(`TikTok profile "${username}" not found`);
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Failed to load TikTok profile page (status ${response.status})`);
  }

  const html = await response.text();
  const universalData = extractUniversalDataFromHtml(html);
  const scope = universalData?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  const userInfo = scope?.userInfo;

  if (!userInfo?.user) {
    throw new Error('Unable to extract user information from profile');
  }

  const user = userInfo.user;

  return {
    username: user.uniqueId || username,
    nickname: user.nickname || '',
    bio: user.signature || '',
    verified: user.verified || false,
    followerCount: userInfo.stats?.followerCount || 0,
    followingCount: userInfo.stats?.followingCount || 0,
    videoCount: userInfo.stats?.videoCount || 0,
    heartCount: userInfo.stats?.heartCount || 0,
    avatarUrl: user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
    profileUrl: `https://www.tiktok.com/@${user.uniqueId || username}`
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-TikTok-Cookie');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Vary', 'Origin, X-TikTok-Cookie');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'success' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', status: 'error', code: 405 });
  }

  // Require API key authentication
  if (!requireApiKey(req, res)) {
    return;
  }

  const username = req.query.username;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({
      error: 'Missing required parameter: username',
      status: 'error',
      code: 400
    });
  }

  const cleanUsername = username.trim().replace(/^@/, '');

  if (!/^[\w.-]+$/.test(cleanUsername)) {
    return res.status(400).json({
      error: 'Invalid username format',
      status: 'error',
      code: 400
    });
  }

  const cookies = getCookies(req);
  const cacheKey = createCacheKey(cleanUsername, cookies);

  // Check for fresh data request (bypasses cache)
  const forceFresh = req.query.fresh === 'true';

  if (!forceFresh) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
  }

  res.setHeader('X-Cache', forceFresh ? 'BYPASS' : 'MISS');

  try {
    const bioData = await fetchBio(cleanUsername, cookies);
    
    const responsePayload = {
      status: 'success',
      data: bioData
    };

    storeCachedResponse(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('TikTok bio handler error:', error);

    let statusCode = 500;
    let message = 'Unexpected error while processing the request';

    if (error.code === 'PROFILE_NOT_FOUND') {
      statusCode = 404;
      message = `TikTok profile "${cleanUsername}" not found`;
    } else if (/timeout/i.test(error.message)) {
      statusCode = 504;
      message = 'Timed out while loading TikTok profile';
    }

    return res.status(statusCode).json({
      error: message,
      status: 'error',
      code: statusCode
    });
  }
}

