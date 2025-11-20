// lib/auth.js - API Key Authentication
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    // Try multiple possible locations for api-keys.json
    const possiblePaths = [
      join(__dirname, '..', 'api-keys.json'),  // Relative to lib directory
      join(process.cwd(), 'api-keys.json'),     // Project root
      '/var/task/api-keys.json'                  // Vercel/Lambda root
    ];

    let fileContent = null;
    let successPath = null;

    for (const keysPath of possiblePaths) {
      try {
        fileContent = readFileSync(keysPath, 'utf8');
        successPath = keysPath;
        break;
      } catch (err) {
        // Try next path
        continue;
      }
    }

    if (!fileContent) {
      throw new Error('api-keys.json not found in any expected location');
    }

    const data = JSON.parse(fileContent);
    
    cachedKeys = data.keys || [];
    lastLoadTime = now;
    
    console.log(`API keys loaded successfully from: ${successPath}`);
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

  // Make API key optional - if not provided, just log and continue
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    console.log('Request without API key - allowing access (API key optional)');
    return true;
  }

  const validation = validateApiKey(apiKey);

  if (!validation.valid) {
    console.warn(`Invalid API key provided: ${validation.error}`);
    // Still allow access but log the warning
    return true;
  }

  console.log(`Valid API key used: ${validation.keyName}`);
  return true;
}

