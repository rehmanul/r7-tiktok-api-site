import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import tiktokHandler from './api/tiktok.js';
import bioHandler from './api/bio.js';
import docsHandler from './api/docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, 'public');

const app = express();
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

app.set('trust proxy', true);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(express.static(staticDir, { extensions: ['html'] }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || 'unknown'
  });
});

app.get('/api/tiktok', (req, res, next) => {
  return tiktokHandler(req, res).catch(next);
});

app.get('/api/bio', (req, res, next) => {
  return bioHandler(req, res).catch(next);
});

app.get('/api/docs', (req, res, next) => {
  return docsHandler(req, res).catch(next);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', status: 'error', code: 404 });
});

app.use((req, res, next) => {
  if (req.method === 'GET') {
    return res.sendFile('index.html', { root: staticDir });
  }
  return next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', status: 'error', code: 404 });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({ error: 'Internal server error', status: 'error', code: 500 });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
