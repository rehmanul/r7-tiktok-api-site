// lib/auth.js - API Key Authentication
import { readFileSync } from 'fs';
import { join } from 'path';

let cachedKeys = null;
let lastLoadTime = 0;
const CACHE_DURATION = 60000; // 1 minute cache

function loadApiKeys() {
  const now = Date.now();
  
  // Return cached keys if still fresh
  if (cachedKeys && (now - lastLoadTime) < CACHE_DURATION) {
    return cachedKeys;
  }

  try {
    const keysPath = join(process.cwd(), 'api-keys.json');
    const fileContent = readFileSync(keysPath, 'utf8');
    const data = JSON.parse(fileContent);
    
    cachedKeys = data.keys || [];
    lastLoadTime = now;
    
    return cachedKeys;
  } catch (error) {
    console.error('Failed to load API keys:', error);
    // Fallback to default keys if file can't be read
    return [
      { key: 'admin', name: 'Admin Key', enabled: true },
      { key: 'darkcampaign', name: 'Dark Campaign Key', enabled: true }
    ];
  }
}

export function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'Missing API key' };
  }

  const keys = loadApiKeys();
  const keyEntry = keys.find(k => k.key === apiKey);

  if (!keyEntry) {
    return { valid: false, error: 'Invalid API key' };
  }

  if (!keyEntry.enabled) {
    return { valid: false, error: 'API key is disabled' };
  }

  return { valid: true, keyName: keyEntry.name };
}

export function requireApiKey(req, res) {
  const apiKey = req.query.apiKey;

  const validation = validateApiKey(apiKey);

  if (!validation.valid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: validation.error,
      status: 'error',
      code: 401,
      hint: 'Include a valid API key in the query string: ?apiKey=YOUR_KEY'
    });
    return false;
  }

  return true;
}

