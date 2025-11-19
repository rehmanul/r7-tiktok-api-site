// api/docs.js - API Documentation HTML Page
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('');
  }

  if (req.method !== 'GET') {
    return res.status(405).send('<h1>405 Method Not Allowed</h1>');
  }

  const baseUrl = `https://${req.headers.host}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TikTok API Documentation</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }

        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }

        .version {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-top: 10px;
        }

        .content {
            padding: 40px;
        }

        .section {
            margin-bottom: 50px;
        }

        .section h2 {
            color: #667eea;
            font-size: 1.8em;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 3px solid #667eea;
        }

        .section h3 {
            color: #764ba2;
            font-size: 1.4em;
            margin: 25px 0 15px 0;
        }

        .auth-box {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
        }

        .auth-box strong {
            color: #667eea;
            font-size: 1.1em;
        }

        .endpoint {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 25px;
            margin: 25px 0;
            border: 1px solid #e9ecef;
        }

        .endpoint-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            flex-wrap: wrap;
            gap: 10px;
        }

        .method {
            background: #28a745;
            color: white;
            padding: 5px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 0.85em;
        }

        .path {
            font-family: 'Courier New', monospace;
            font-size: 1.2em;
            color: #333;
            font-weight: 600;
        }

        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.75em;
            font-weight: 600;
            text-transform: uppercase;
        }

        .badge-required {
            background: #dc3545;
            color: white;
        }

        .badge-optional {
            background: #6c757d;
            color: white;
        }

        .badge-fast {
            background: #28a745;
            color: white;
        }

        .badge-slow {
            background: #ffc107;
            color: #333;
        }

        .param-table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 0.95em;
        }

        .param-table th {
            background: #667eea;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }

        .param-table td {
            padding: 12px;
            border-bottom: 1px solid #e9ecef;
        }

        .param-table tr:hover {
            background: #f8f9fa;
        }

        .code-block {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 15px 0;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            line-height: 1.5;
        }

        .code-block .comment {
            color: #6a9955;
        }

        .code-block .string {
            color: #ce9178;
        }

        .code-block .keyword {
            color: #c586c0;
        }

        .code-block .function {
            color: #dcdcaa;
        }

        .example-box {
            background: #e7f3ff;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 15px 0;
            border-radius: 4px;
        }

        .example-box strong {
            color: #2196F3;
        }

        .copy-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            margin-top: 10px;
        }

        .copy-btn:hover {
            background: #5568d3;
        }

        .response-example {
            margin: 15px 0;
        }

        .success-response {
            border-left: 4px solid #28a745;
        }

        .error-response {
            border-left: 4px solid #dc3545;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }

        .card {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }

        .card h4 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 1.1em;
        }

        .card p {
            color: #666;
            font-size: 0.9em;
        }

        .error-codes {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 10px 20px;
            margin: 20px 0;
        }

        .error-code {
            font-weight: bold;
            color: #667eea;
            font-family: monospace;
        }

        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }

        .note strong {
            color: #856404;
        }

        ul {
            margin-left: 20px;
            margin-top: 10px;
        }

        li {
            margin: 8px 0;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 1.8em;
            }
            
            .content {
                padding: 20px;
            }
            
            .param-table {
                font-size: 0.85em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 TikTok API</h1>
            <p>Fetch TikTok user videos and profile data</p>
            <span class="version">v1.0.0</span>
        </div>

        <div class="content">
            <!-- Authentication -->
            <div class="section">
                <h2>🔐 Authentication</h2>
                <div class="auth-box">
                    <strong>All endpoints require an API key</strong><br><br>
                    Include your API key in the query string:<br>
                    <code>?apiKey=YOUR_API_KEY</code>
                </div>
                <div class="example-box">
                    <strong>Example:</strong><br>
                    <code>${baseUrl}/api/tiktok?username=charlidamelio&apiKey=admin</code>
                </div>
            </div>

            <!-- Base URL -->
            <div class="section">
                <h2>🌐 Base URL</h2>
                <div class="code-block">${baseUrl}</div>
            </div>

            <!-- Endpoints Overview -->
            <div class="section">
                <h2>📍 Endpoints</h2>
                <div class="grid">
                    <div class="card">
                        <h4>/api/tiktok</h4>
                        <p>Get user videos with pagination</p>
                        <span class="badge badge-slow">5-10s</span>
                    </div>
                    <div class="card">
                        <h4>/api/bio</h4>
                        <p>Get user profile and bio</p>
                        <span class="badge badge-fast">1-3s</span>
                    </div>
                    <div class="card">
                        <h4>/api/docs</h4>
                        <p>API documentation (this page)</p>
                        <span class="badge badge-fast">&lt;100ms</span>
                    </div>
                </div>
            </div>

            <!-- Endpoint: /api/tiktok -->
            <div class="section">
                <h2>📹 GET /api/tiktok</h2>
                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method">GET</span>
                        <span class="path">/api/tiktok</span>
                        <span class="badge badge-required">Auth Required</span>
                    </div>
                    <p>Fetch TikTok user videos with pagination, filtering, and sorting.</p>

                    <h3>Parameters</h3>
                    <table class="param-table">
                        <thead>
                            <tr>
                                <th>Parameter</th>
                                <th>Type</th>
                                <th>Required</th>
                                <th>Description</th>
                                <th>Example</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>username</code></td>
                                <td>string</td>
                                <td><span class="badge badge-required">Required</span></td>
                                <td>TikTok username (with or without @)</td>
                                <td>charlidamelio</td>
                            </tr>
                            <tr>
                                <td><code>apiKey</code></td>
                                <td>string</td>
                                <td><span class="badge badge-required">Required</span></td>
                                <td>Your API key</td>
                                <td>admin</td>
                            </tr>
                            <tr>
                                <td><code>page</code></td>
                                <td>number</td>
                                <td><span class="badge badge-optional">Optional</span></td>
                                <td>Page number (default: 1)</td>
                                <td>1</td>
                            </tr>
                            <tr>
                                <td><code>per_page</code></td>
                                <td>number</td>
                                <td><span class="badge badge-optional">Optional</span></td>
                                <td>Posts per page (1-100, default: 30)</td>
                                <td>30</td>
                            </tr>
                            <tr>
                                <td><code>start_epoch</code></td>
                                <td>number</td>
                                <td><span class="badge badge-optional">Optional</span></td>
                                <td>Filter videos after this timestamp</td>
                                <td>1640995200</td>
                            </tr>
                            <tr>
                                <td><code>end_epoch</code></td>
                                <td>number</td>
                                <td><span class="badge badge-optional">Optional</span></td>
                                <td>Filter videos before this timestamp</td>
                                <td>1672531199</td>
                            </tr>
                        </tbody>
                    </table>

                    <h3>Example Request</h3>
                    <div class="code-block">curl "${baseUrl}/api/tiktok?username=charlidamelio&page=1&per_page=10&apiKey=admin"</div>

                    <h3>Response (200 OK)</h3>
                    <div class="code-block success-response">{
  <span class="string">"status"</span>: <span class="string">"success"</span>,
  <span class="string">"meta"</span>: {
    <span class="string">"username"</span>: <span class="string">"charlidamelio"</span>,
    <span class="string">"page"</span>: 1,
    <span class="string">"total_pages"</span>: 10,
    <span class="string">"posts_per_page"</span>: 10,
    <span class="string">"total_posts"</span>: 100,
    <span class="string">"cache_status"</span>: <span class="string">"HIT"</span>
  },
  <span class="string">"data"</span>: [
    {
      <span class="string">"video_id"</span>: <span class="string">"7123456789012345678"</span>,
      <span class="string">"video_url"</span>: <span class="string">"https://www.tiktok.com/@charlidamelio/video/..."</span>,
      <span class="string">"description"</span>: <span class="string">"Check this out!"</span>,
      <span class="string">"views"</span>: 1234567,
      <span class="string">"likes"</span>: 123456,
      <span class="string">"comments"</span>: 12345,
      <span class="string">"shares"</span>: 1234,
      <span class="string">"epoch_time_posted"</span>: 1640995200
    }
  ]
}</div>

                    <div class="note">
                        <strong>⚡ Performance:</strong> Edge cached for 2 minutes. First request: 5-10s, cached: &lt;100ms
                    </div>
                </div>
            </div>

            <!-- Endpoint: /api/bio -->
            <div class="section">
                <h2>👤 GET /api/bio</h2>
                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method">GET</span>
                        <span class="path">/api/bio</span>
                        <span class="badge badge-required">Auth Required</span>
                    </div>
                    <p>Fetch TikTok user profile information including bio, follower counts, and avatar.</p>

                    <h3>Parameters</h3>
                    <table class="param-table">
                        <thead>
                            <tr>
                                <th>Parameter</th>
                                <th>Type</th>
                                <th>Required</th>
                                <th>Description</th>
                                <th>Example</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>username</code></td>
                                <td>string</td>
                                <td><span class="badge badge-required">Required</span></td>
                                <td>TikTok username (with or without @)</td>
                                <td>charlidamelio</td>
                            </tr>
                            <tr>
                                <td><code>apiKey</code></td>
                                <td>string</td>
                                <td><span class="badge badge-required">Required</span></td>
                                <td>Your API key</td>
                                <td>admin</td>
                            </tr>
                        </tbody>
                    </table>

                    <h3>Example Request</h3>
                    <div class="code-block">curl "${baseUrl}/api/bio?username=charlidamelio&apiKey=admin"</div>

                    <h3>Response (200 OK)</h3>
                    <div class="code-block success-response">{
  <span class="string">"status"</span>: <span class="string">"success"</span>,
  <span class="string">"data"</span>: {
    <span class="string">"username"</span>: <span class="string">"charlidamelio"</span>,
    <span class="string">"nickname"</span>: <span class="string">"charli d'amelio"</span>,
    <span class="string">"bio"</span>: <span class="string">"i love my job 🤍"</span>,
    <span class="string">"verified"</span>: true,
    <span class="string">"followerCount"</span>: 155000000,
    <span class="string">"followingCount"</span>: 1543,
    <span class="string">"videoCount"</span>: 2456,
    <span class="string">"heartCount"</span>: 9800000000,
    <span class="string">"avatarUrl"</span>: <span class="string">"https://..."</span>,
    <span class="string">"profileUrl"</span>: <span class="string">"https://www.tiktok.com/@charlidamelio"</span>
  }
}</div>

                    <div class="note">
                        <strong>⚡ Performance:</strong> Edge cached for 5 minutes. Much faster than /api/tiktok (no browser needed)
                    </div>
                </div>
            </div>

            <!-- Error Codes -->
            <div class="section">
                <h2>⚠️ Error Codes</h2>
                <div class="error-codes">
                    <span class="error-code">200</span><span>✅ Success</span>
                    <span class="error-code">400</span><span>❌ Bad Request - Invalid parameters</span>
                    <span class="error-code">401</span><span>🔒 Unauthorized - Invalid or missing API key</span>
                    <span class="error-code">404</span><span>🚫 Not Found - Profile not found</span>
                    <span class="error-code">405</span><span>⛔ Method Not Allowed - Only GET supported</span>
                    <span class="error-code">429</span><span>⏱️ Too Many Requests - Rate limit exceeded</span>
                    <span class="error-code">500</span><span>💥 Internal Server Error</span>
                    <span class="error-code">504</span><span>⏰ Gateway Timeout - Request too slow</span>
                </div>

                <h3>Error Response Example</h3>
                <div class="code-block error-response">{
  <span class="string">"error"</span>: <span class="string">"Unauthorized"</span>,
  <span class="string">"message"</span>: <span class="string">"Missing API key"</span>,
  <span class="string">"status"</span>: <span class="string">"error"</span>,
  <span class="string">"code"</span>: 401,
  <span class="string">"hint"</span>: <span class="string">"Include a valid API key: ?apiKey=YOUR_KEY"</span>
}</div>
            </div>

            <!-- Code Examples -->
            <div class="section">
                <h2>💻 Code Examples</h2>
                
                <h3>JavaScript (Fetch)</h3>
                <div class="code-block"><span class="keyword">async</span> <span class="keyword">function</span> <span class="function">getTikTokVideos</span>(username, apiKey) {
  <span class="keyword">const</span> response = <span class="keyword">await</span> <span class="function">fetch</span>(
    <span class="string">\`${baseUrl}/api/tiktok?username=\${username}&apiKey=\${apiKey}\`</span>
  );
  <span class="keyword">const</span> data = <span class="keyword">await</span> response.<span class="function">json</span>();
  <span class="keyword">return</span> data;
}

<span class="keyword">async</span> <span class="keyword">function</span> <span class="function">getTikTokBio</span>(username, apiKey) {
  <span class="keyword">const</span> response = <span class="keyword">await</span> <span class="function">fetch</span>(
    <span class="string">\`${baseUrl}/api/bio?username=\${username}&apiKey=\${apiKey}\`</span>
  );
  <span class="keyword">const</span> data = <span class="keyword">await</span> response.<span class="function">json</span>();
  <span class="keyword">return</span> data;
}</div>

                <h3>Python (Requests)</h3>
                <div class="code-block"><span class="keyword">import</span> requests

<span class="keyword">def</span> <span class="function">get_tiktok_videos</span>(username, api_key):
    url = <span class="string">f"${baseUrl}/api/tiktok"</span>
    params = {<span class="string">"username"</span>: username, <span class="string">"apiKey"</span>: api_key}
    response = requests.get(url, params=params)
    <span class="keyword">return</span> response.json()

<span class="keyword">def</span> <span class="function">get_tiktok_bio</span>(username, api_key):
    url = <span class="string">f"${baseUrl}/api/bio"</span>
    params = {<span class="string">"username"</span>: username, <span class="string">"apiKey"</span>: api_key}
    response = requests.get(url, params=params)
    <span class="keyword">return</span> response.json()</div>
            </div>

            <!-- Rate Limits -->
            <div class="section">
                <h2>⏱️ Rate Limits</h2>
                <div class="grid">
                    <div class="card">
                        <h4>Per Minute</h4>
                        <p style="font-size: 2em; color: #667eea; font-weight: bold;">60</p>
                        <p>requests</p>
                    </div>
                    <div class="card">
                        <h4>Per Hour</h4>
                        <p style="font-size: 2em; color: #667eea; font-weight: bold;">1000</p>
                        <p>requests</p>
                    </div>
                </div>
                <div class="note">
                    <strong>Note:</strong> Rate limits are enforced per API key. Upgrade for higher limits.
                </div>
            </div>

            <!-- Notes -->
            <div class="section">
                <h2>📝 Important Notes</h2>
                <ul>
                    <li>✅ All endpoints return JSON responses</li>
                    <li>🔐 API keys are required for <code>/api/tiktok</code> and <code>/api/bio</code></li>
                    <li>⚡ Data is cached at the edge for faster response times</li>
                    <li>🌍 TikTok may rate limit or block requests without valid cookies</li>
                    <li>🔒 For private content, include TikTok session cookies via <code>X-TikTok-Cookie</code> header</li>
                    <li>📊 Check <code>X-Cache</code> response header to see if response was cached</li>
                </ul>
            </div>

            <!-- Footer -->
            <div class="section" style="text-align: center; padding: 40px 0; border-top: 2px solid #e9ecef;">
                <p style="color: #666; font-size: 0.9em;">
                    Built with ❤️ | Powered by Vercel<br>
                    <strong>TikTok API v1.0.0</strong>
                </p>
            </div>
        </div>
    </div>
</body>
</html>
  `.trim();

  return res.status(200).send(html);
}
