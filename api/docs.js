// api/docs.js - API Documentation Endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'success' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', status: 'error', code: 405 });
  }

  const docs = {
    title: 'TikTok API Documentation',
    version: '1.0.0',
    description: 'API for fetching TikTok user videos and profile information',
    baseUrl: `https://${req.headers.host}`,
    authentication: {
      type: 'API Key',
      location: 'Query Parameter',
      parameter: 'apiKey',
      example: '?apiKey=YOUR_API_KEY',
      note: 'All endpoints require a valid API key'
    },
    endpoints: [
      {
        path: '/api/tiktok',
        method: 'GET',
        description: 'Fetch TikTok user videos with pagination and filtering',
        authentication: 'Required',
        parameters: {
          required: [
            {
              name: 'username',
              type: 'string',
              description: 'TikTok username (with or without @)',
              example: 'charlidamelio'
            },
            {
              name: 'apiKey',
              type: 'string',
              description: 'Your API key',
              example: 'admin'
            }
          ],
          optional: [
            {
              name: 'page',
              type: 'number',
              default: 1,
              description: 'Page number for pagination',
              example: 1
            },
            {
              name: 'per_page',
              type: 'number',
              default: 30,
              description: 'Number of posts per page (1-100)',
              example: 30
            },
            {
              name: 'start_epoch',
              type: 'number',
              description: 'Filter videos posted after this Unix timestamp',
              example: 1640995200
            },
            {
              name: 'end_epoch',
              type: 'number',
              description: 'Filter videos posted before this Unix timestamp',
              example: 1672531199
            }
          ]
        },
        headers: {
          optional: [
            {
              name: 'X-TikTok-Cookie',
              type: 'string',
              description: 'TikTok session cookies for authenticated access',
              example: 'sessionid=xxx; tt_csrf_token=yyy'
            }
          ]
        },
        response: {
          success: {
            status: 'success',
            meta: {
              username: 'charlidamelio',
              page: 1,
              total_pages: 10,
              posts_per_page: 30,
              total_posts: 300,
              cache_status: 'HIT',
              fetch_method: 'http'
            },
            data: [
              {
                video_id: '7123456789012345678',
                video_url: 'https://www.tiktok.com/@charlidamelio/video/7123456789012345678',
                description: 'Check out this video!',
                views: 1234567,
                likes: 123456,
                comments: 12345,
                shares: 1234,
                epoch_time_posted: 1640995200,
                thumbnail_url: 'https://...'
              }
            ]
          },
          error: {
            error: 'Error message',
            status: 'error',
            code: 400
          }
        },
        example: {
          request: 'GET /api/tiktok?username=charlidamelio&page=1&per_page=10&apiKey=YOUR_KEY',
          curl: 'curl "https://your-domain.vercel.app/api/tiktok?username=charlidamelio&apiKey=YOUR_KEY"'
        },
        performance: {
          cache: '120 seconds edge cache',
          cold_start: '5-10 seconds',
          cached: '50-100ms',
          cpu: 'High (Chromium browser)'
        }
      },
      {
        path: '/api/bio',
        method: 'GET',
        description: 'Fetch TikTok user profile and bio information',
        authentication: 'Required',
        parameters: {
          required: [
            {
              name: 'username',
              type: 'string',
              description: 'TikTok username (with or without @)',
              example: 'charlidamelio'
            },
            {
              name: 'apiKey',
              type: 'string',
              description: 'Your API key',
              example: 'admin'
            }
          ]
        },
        headers: {
          optional: [
            {
              name: 'X-TikTok-Cookie',
              type: 'string',
              description: 'TikTok session cookies for authenticated access',
              example: 'sessionid=xxx; tt_csrf_token=yyy'
            }
          ]
        },
        response: {
          success: {
            status: 'success',
            data: {
              username: 'charlidamelio',
              nickname: 'charli d\'amelio',
              bio: 'i love my job 🤍',
              verified: true,
              followerCount: 155000000,
              followingCount: 1543,
              videoCount: 2456,
              heartCount: 9800000000,
              avatarUrl: 'https://p16-sign-va.tiktokcdn.com/...',
              profileUrl: 'https://www.tiktok.com/@charlidamelio'
            }
          },
          error: {
            error: 'Error message',
            status: 'error',
            code: 404
          }
        },
        example: {
          request: 'GET /api/bio?username=charlidamelio&apiKey=YOUR_KEY',
          curl: 'curl "https://your-domain.vercel.app/api/bio?username=charlidamelio&apiKey=YOUR_KEY"'
        },
        performance: {
          cache: '300 seconds edge cache',
          cold_start: '1-3 seconds',
          cached: '50-100ms',
          cpu: 'Low (HTTP only, no browser)'
        }
      },
      {
        path: '/api/docs',
        method: 'GET',
        description: 'View this API documentation',
        authentication: 'Not Required',
        response: {
          success: {
            title: 'TikTok API Documentation',
            version: '1.0.0',
            endpoints: '...'
          }
        },
        example: {
          request: 'GET /api/docs',
          curl: 'curl "https://your-domain.vercel.app/api/docs"'
        }
      }
    ],
    errorCodes: {
      200: 'Success',
      400: 'Bad Request - Invalid parameters',
      401: 'Unauthorized - Invalid or missing API key',
      404: 'Not Found - Profile not found',
      405: 'Method Not Allowed - Only GET requests supported',
      429: 'Too Many Requests - Rate limit exceeded',
      500: 'Internal Server Error',
      504: 'Gateway Timeout - Request took too long'
    },
    rateLimits: {
      perMinute: 60,
      perHour: 1000,
      note: 'Rate limits are enforced per API key'
    },
    caching: {
      '/api/tiktok': {
        ttl: '120 seconds',
        staleWhileRevalidate: '300 seconds',
        note: 'Video data cached for 2 minutes'
      },
      '/api/bio': {
        ttl: '300 seconds',
        staleWhileRevalidate: '600 seconds',
        note: 'Profile data cached for 5 minutes'
      }
    },
    examples: {
      javascript: {
        fetch: `
// Fetch user videos
async function getTikTokVideos(username, apiKey) {
  const response = await fetch(
    \`https://your-domain.vercel.app/api/tiktok?username=\${username}&apiKey=\${apiKey}\`
  );
  const data = await response.json();
  return data;
}

// Fetch user bio
async function getTikTokBio(username, apiKey) {
  const response = await fetch(
    \`https://your-domain.vercel.app/api/bio?username=\${username}&apiKey=\${apiKey}\`
  );
  const data = await response.json();
  return data;
}
        `.trim()
      },
      python: {
        requests: `
import requests

# Fetch user videos
def get_tiktok_videos(username, api_key):
    url = f"https://your-domain.vercel.app/api/tiktok"
    params = {"username": username, "apiKey": api_key}
    response = requests.get(url, params=params)
    return response.json()

# Fetch user bio
def get_tiktok_bio(username, api_key):
    url = f"https://your-domain.vercel.app/api/bio"
    params = {"username": username, "apiKey": api_key}
    response = requests.get(url, params=params)
    return response.json()
        `.trim()
      },
      curl: {
        videos: 'curl "https://your-domain.vercel.app/api/tiktok?username=charlidamelio&page=1&per_page=10&apiKey=YOUR_KEY"',
        bio: 'curl "https://your-domain.vercel.app/api/bio?username=charlidamelio&apiKey=YOUR_KEY"'
      }
    },
    notes: [
      'All endpoints return JSON responses',
      'API keys are required for /api/tiktok and /api/bio endpoints',
      'Data is cached at the edge for faster response times',
      'TikTok may rate limit or block requests without valid cookies',
      'For private or restricted content, include TikTok session cookies via X-TikTok-Cookie header'
    ]
  };

  return res.status(200).json(docs);
}

