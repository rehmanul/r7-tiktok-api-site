// Diagnostic endpoint to check environment configuration
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check environment variables (mask sensitive parts)
  const config = {
    node_env: process.env.NODE_ENV || 'not set',
    use_brightdata: process.env.USE_BRIGHTDATA || 'not set',
    brightdata_url_configured: process.env.BRIGHTDATA_BROWSER_URL ? 'YES' : 'NO',
    brightdata_url_preview: process.env.BRIGHTDATA_BROWSER_URL
      ? process.env.BRIGHTDATA_BROWSER_URL.substring(0, 50) + '...'
      : 'not set',
    tiktok_cookie_configured: process.env.TIKTOK_COOKIE ? 'YES' : 'NO',
    instagram_cookie_configured: process.env.INSTAGRAM_COOKIE ? 'YES' : 'NO',
    youtube_cookie_configured: process.env.YOUTUBE_COOKIE ? 'YES' : 'NO',
    twitter_cookie_configured: process.env.TWITTER_COOKIE ? 'YES' : 'NO',
    cache_ttl: process.env.CACHE_TTL || 'not set',
    rate_limit_per_minute: process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || 'not set',
    timestamp: new Date().toISOString(),
    platform: 'vercel'
  };

  return res.status(200).json({
    status: 'success',
    message: 'Environment configuration check',
    config
  });
}
