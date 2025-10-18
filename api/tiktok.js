// api/tiktok.js - Vercel Serverless Function

// Hardcoded TikTok cookies - UPDATE THESE PERIODICALLY
const TIKTOK_COOKIES = [
  { name: 'sessionid', value: 'e85eed433bfc35720a51d65c4fd7a174', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid', value: 'YOUR_WEBID_HERE', domain: '.tiktok.com', path: '/' },
  { name: 'tt_webid_v2', value: 'YOUR_WEBID_V2_HERE', domain: '.tiktok.com', path: '/' },
  { name: 'msToken', value: 'fIP-cv0nih4qbA7jIK9cLt9oRZbmpcVFJwzvJzQPjN0n_KDGJMXd6At8hMp6W5foQkGzRe5krq233XRsznxRzKm5XVJZ0kcE18jM4mQSmQSz2dXUJr51TMevVaMA4pJWwUq9dULVG5UgVNVdiV10EqHpFQ==', domain: '.tiktok.com', path: '/' }
];

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', status: 'error' });
  }

  try {
    // Extract parameters
    const { username, page: pageParam = 1, 'per-page': perPage = 10, start_epoch, end_epoch } = req.query;

    // Validate required parameters
    if (!username) {
      return res.status(400).json({
        error: 'Missing required parameter: username',
        status: 'error',
        code: 400
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(pageParam);
    const perPageNum = Math.min(parseInt(perPage), 100);

    if (pageNum < 1 || perPageNum < 1) {
      return res.status(400).json({
        error: 'Invalid pagination parameters',
        status: 'error',
        code: 400
      });
    }

    // Parse epoch filters
    const startEpoch = start_epoch ? parseInt(start_epoch) : null;
    const endEpoch = end_epoch ? parseInt(end_epoch) : null;

    // Launch browser with environment-specific configuration
    let browser;
    // Force local development mode for Windows environment
    const isServerless = false; // process.env.VERCEL || process.env.AWS_LAMBDA || process.env.LAMBDA_TASK_ROOT;
    console.log('Environment check:', { isServerless, NODE_ENV: process.env.NODE_ENV, platform: process.platform });

    if (isServerless) {
      // Serverless environment - use puppeteer-core with serverless chromium
      const { default: puppeteerCore } = await import('puppeteer-core');
      const chromiumPkg = await import('@sparticuz/chromium');

      browser = await puppeteerCore.launch({
        args: [
          ...chromiumPkg.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-ipc-flooding-protection'
        ],
        executablePath: await chromiumPkg.executablePath(),
        headless: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        ignoreHTTPSErrors: true,
        timeout: 60000
      });
    } else {
      // Local development - use regular puppeteer
      const { default: puppeteerLocal } = await import('puppeteer');

      browser = await puppeteerLocal.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
        timeout: 60000
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    // Add cookies for authentication
    await context.addCookies(TIKTOK_COOKIES);

    const page = await context.newPage();

    // Track API responses
    const apiResponses = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/post/item_list/') || url.includes('/api/user/detail/')) {
        try {
          const data = await response.json();
          apiResponses.push({ url, data });
        } catch (e) {
          // Ignore non-JSON responses
        }
      }
    });

    // Navigate to user profile
    await page.goto(`https://www.tiktok.com/@${username}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Extract video data from intercepted API calls
    let allVideos = [];

    for (const apiResponse of apiResponses) {
      if (apiResponse.data.itemList) {
        allVideos = allVideos.concat(apiResponse.data.itemList);
      }
    }

    // If no API data, scrape from DOM
    if (allVideos.length === 0) {
      const videoElements = await page.$$eval('[data-e2e="user-post-item"]', (elements) => {
        return elements.map(el => {
          const link = el.querySelector('a');
          const desc = el.querySelector('[data-e2e="user-post-item-desc"]');
          return {
            videoUrl: link ? link.href : null,
            description: desc ? desc.textContent : ''
          };
        });
      });

      allVideos = videoElements;
    }

    // Parse and format videos
    const formattedVideos = allVideos.map(video => {
      const videoId = extractVideoId(video);
      const createTime = video.createTime || video.create_time || extractTimestampFromVideo(video);
      const stats = video.stats || {};

      return {
        video_id: videoId,
        url: `https://www.tiktok.com/@${username}/video/${videoId}`,
        description: video.desc || video.description || '',
        epoch_time_posted: createTime,
        views: stats.playCount || stats.play_count || 0,
        likes: stats.diggCount || stats.like_count || 0,
        comments: stats.commentCount || stats.comment_count || 0,
        shares: stats.shareCount || stats.share_count || 0
      };
    });

    // Filter by epoch timestamp
    let filteredVideos = formattedVideos;
    if (startEpoch || endEpoch) {
      filteredVideos = formattedVideos.filter(video => {
        const videoTime = video.epoch_time_posted;
        if (startEpoch && videoTime < startEpoch) return false;
        if (endEpoch && videoTime > endEpoch) return false;
        return true;
      });
    }

    // Sort by epoch time (most recent first)
    filteredVideos.sort((a, b) => b.epoch_time_posted - a.epoch_time_posted);

    // Calculate pagination
    const totalPosts = filteredVideos.length;
    const totalPages = Math.ceil(totalPosts / perPageNum);
    const startIndex = (pageNum - 1) * perPageNum;
    const endIndex = startIndex + perPageNum;
    const paginatedVideos = filteredVideos.slice(startIndex, endIndex);

    // Calculate first and last video epochs
    const firstVideoEpoch = filteredVideos.length > 0 ? filteredVideos[0].epoch_time_posted : null;
    const lastVideoEpoch = filteredVideos.length > 0 ? filteredVideos[filteredVideos.length - 1].epoch_time_posted : null;

    await browser.close();

    // Build response
    const response = {
      meta: {
        page: pageNum,
        total_pages: totalPages,
        posts_per_page: perPageNum,
        total_posts: totalPosts,
        start_epoch: startEpoch,
        end_epoch: endEpoch,
        first_video_epoch: firstVideoEpoch,
        last_video_epoch: lastVideoEpoch,
        request_time: Math.floor(Date.now() / 1000),
        username: username
      },
      data: paginatedVideos,
      status: 'success'
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error:', error);

    // Provide more specific error messages for common issues
    let errorMessage = error.message;
    let statusCode = 500;

    if (error.message.includes('Browser launch failed')) {
      errorMessage = 'Browser automation failed - please try again later';
      statusCode = 503;
    } else if (error.message.includes('Navigation timeout')) {
      errorMessage = 'Request timeout - TikTok may be rate limiting';
      statusCode = 429;
    } else if (error.message.includes('net::ERR')) {
      errorMessage = 'Network error - please check the username and try again';
      statusCode = 400;
    }

    return res.status(statusCode).json({
      error: errorMessage,
      status: 'error',
      code: statusCode,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Helper function to extract video ID
function extractVideoId(video) {
  if (video.id) return video.id;
  if (video.video_id) return video.video_id;
  if (video.videoUrl) {
    const match = video.videoUrl.match(/video\/([0-9]+)/);
    return match ? match[1] : null;
  }
  return null;
}

// Helper function to extract timestamp
function extractTimestampFromVideo(video) {
  if (video.createTime) return video.createTime;
  if (video.create_time) return video.create_time;
  return Math.floor(Date.now() / 1000);
}
