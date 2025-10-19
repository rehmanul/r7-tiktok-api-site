// api/tiktok.js - Vercel Serverless Function
import puppeteer from 'puppeteer';

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

    // Launch browser with puppeteer for local development
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Add cookies for authentication
    await page.setCookie(...TIKTOK_COOKIES);

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
    try {
      await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (navError) {
      console.log('Navigation timeout, continuing with partial load...');
    }

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Extract video data from intercepted API calls
    let allVideos = [];

    for (const apiResponse of apiResponses) {
      if (apiResponse.data.itemList) {
        allVideos = allVideos.concat(apiResponse.data.itemList);
      }
    }

    // If no API data, scrape from DOM
    if (allVideos.length === 0) {
      const videoElements = await page.$$('.css-1as5j2b-DivWrapper, [data-e2e="user-post-item"]');

      for (const element of videoElements) {
        try {
          const videoUrl = await element.$eval('a', el => el.href);
          const description = await element.$eval('[data-e2e="user-post-item-desc"]', el => el.textContent);

          allVideos.push({
            videoUrl,
            description
          });
        } catch (e) {
          // Skip elements that don't match expected structure
        }
      }
    }

    // Parse and format videos
    const formattedVideos = allVideos.map(video => {
      // Extract video ID from URL or use fallback
      let videoId = '';
      if (video.id) {
        videoId = video.id;
      } else if (video.videoUrl) {
        const match = video.videoUrl.match(/video\/(\d+)/);
        videoId = match ? match[1] : '';
      } else {
        videoId = Math.random().toString(36).substring(2, 15);
      }

      // Get create time or use current time as fallback
      const createTime = video.createTime || video.create_time || Math.floor(Date.now() / 1000);

      // Get stats or use empty object as fallback
      const stats = video.stats || {};

      return {
        video_id: videoId,
        url: video.videoUrl || `https://www.tiktok.com/@${username}/video/${videoId}`,
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
        first_video_epoch: filteredVideos.length > 0 ? filteredVideos[0].epoch_time_posted : null,
        last_video_epoch: filteredVideos.length > 0 ? filteredVideos[filteredVideos.length - 1].epoch_time_posted : null,
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
