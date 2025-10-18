import express from 'express';
import handler from './api/tiktok.js';

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

<<<<<<< HEAD
// Serve static files from root
app.use(express.static('.'));

=======
>>>>>>> 1bf9d3cd642846544f483b3bb21a9d6a2dd8337f
// Route for TikTok API
app.get('/api/tiktok', async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', status: 'error' });
  }
});

<<<<<<< HEAD
// Root route - serve a simple HTML page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TikTok API System</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                text-align: center;
                margin-bottom: 30px;
            }
            .api-info {
                margin: 20px 0;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 5px;
                border-left: 4px solid #007bff;
            }
            .endpoint {
                margin: 10px 0;
                font-family: monospace;
                background: #e9ecef;
                padding: 5px 10px;
                border-radius: 3px;
            }
            code {
                background: #e9ecef;
                padding: 2px 6px;
                border-radius: 3px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎵 TikTok API System</h1>

            <div class="api-info">
                <h3>API Information</h3>
                <p><strong>Base URL:</strong> <code>http://localhost:${port}</code></p>
                <p><strong>Status:</strong> <span style="color: green;">✅ Running</span></p>
                <p><strong>Last Updated:</strong> ${new Date().toLocaleString()}</p>
            </div>

            <div class="api-info">
                <h3>Available Endpoints</h3>

                <h4>Main API Endpoint:</h4>
                <div class="endpoint">GET /api/tiktok</div>
                <p>Get TikTok user posts and metadata</p>

                <h4>Parameters:</h4>
                <ul>
                    <li><code>username</code> (required): TikTok username without @ symbol</li>
                    <li><code>page</code> (optional): Page number (default: 1)</li>
                    <li><code>per-page</code> (optional): Posts per page (default: 10, max: 100)</li>
                    <li><code>start_epoch</code> (optional): Filter posts after this timestamp</li>
                    <li><code>end_epoch</code> (optional): Filter posts before this timestamp</li>
                </ul>

                <h4>Example Request:</h4>
                <div class="endpoint">GET /api/tiktok?username=techreviewchannel1&page=1&per-page=10</div>

                <h4>Health Check:</h4>
                <div class="endpoint">GET /health</div>
            </div>

            <div class="api-info">
                <h3>Features</h3>
                <ul>
                    <li>✅ Browser automation with Puppeteer</li>
                    <li>✅ Serverless-ready configuration</li>
                    <li>✅ Pagination support</li>
                    <li>✅ Epoch timestamp filtering</li>
                    <li>✅ CORS enabled</li>
                    <li>✅ Error handling with detailed messages</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
=======
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
>>>>>>> 1bf9d3cd642846544f483b3bb21a9d6a2dd8337f
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
<<<<<<< HEAD
  console.log(`API documentation available at http://localhost:${port}/`);
  console.log(`Health check available at http://localhost:${port}/health`);
=======
>>>>>>> 1bf9d3cd642846544f483b3bb21a9d6a2dd8337f
});
