import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Helper to detect environment and load @sparticuz/chromium only when appropriate
async function getChromiumModule() {
  const isServerless = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL);
  const isRender = !!(process.env.RENDER || process.env.IS_RENDER || process.env.PUPPETEER_EXECUTABLE_PATH);

  if (isServerless && !isRender) {
    try {
      const mod = await import('@sparticuz/chromium');
      return mod && (mod.default || mod);
    } catch (err) {
      // If import fails, fall back to Puppeteer's bundled Chromium or system executable
      console.warn('Could not dynamically import @sparticuz/chromium:', err?.message || err);
      return null;
    }
  }

  return null;
}

export async function createBrowser() {
  const chromium = await getChromiumModule();

  // Prefer an explicit executable path from environment (Render/Docker), otherwise fall back to sparticuz or undefined
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (chromium ? await chromium.executablePath() : undefined);

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-features=CrashReporter,Crashpad',
    '--crash-dumps-dir=/tmp',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--hide-scrollbars',
    '--mute-audio',
  ];

  const launchOptions = {
    args,
    headless: 'new',
    ignoreHTTPSErrors: true,
    executablePath,
    userDataDir: '/tmp/puppeteer_' + Date.now(),
    env: {
      ...process.env,
      CHROME_CRASHPAD_PIPE_NAME: '',
      BREAKPAD_DUMP_LOCATION: '/tmp',
    },
    defaultViewport: {
      width: 1920,
      height: 1080,
    },
  };

  try {
    const browser = await puppeteer.launch(launchOptions);
    return browser;
  } catch (err) {
    console.error('Failed to launch Puppeteer browser:', err?.message || err);
    throw err;
  }
}

export default { createBrowser };