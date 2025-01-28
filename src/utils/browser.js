import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getProxyEnabledBrowserOptions } from './proxy-integration.js';

// Configure stealth plugin with additional options
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('chrome.runtime');
stealth.enabledEvasions.delete('iframe.contentWindow');
puppeteer.use(stealth);

// List of rotating User Agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export const browserOptions = {
  headless: 'false',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--disable-blink-features=Site-Per-Process',
    '--disable-features=CrossSiteDocumentBlockingIfIsolating',
    '--disable-features=CrossSiteDocumentBlockingAlways',
    '--disable-features=IsolateOrigins',
    '--disable-site-isolation-trials',
    '--disable-notifications',
    '--window-size=1920,1080',
    '--start-maximized',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-gpu',
    '--incognito',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas', 
    '--disable-extensions'
  ],
  ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
  defaultViewport: {
    width: 1920,
    height: 1080
  }
};

// Helper function to get a random user agent
const getRandomUserAgent = () => {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

async function getBrowser() {
  try {
      if (!browserInstance || !browserInstance.isConnected()) {
          console.log('[Browser] Creating new browser instance');
          browserInstance = await puppeteer.launch(getProxyEnabledBrowserOptions());
      }
      return browserInstance;
  } catch (error) {
      console.error('[Browser] Launch error:', error);
      browserInstance = null;
      throw error;
  }
}

// Function to clear browser data
export async function clearBrowserData(page) {
  try {
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    // Clear localStorage and sessionStorage
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear IndexedDB
      const databases = window.indexedDB.databases();
      databases.then(dbs => {
        dbs.forEach(db => {
          window.indexedDB.deleteDatabase(db.name);
        });
      });
      
      // Clear service workers
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          registrations.forEach(registration => {
            registration.unregister();
          });
        });
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error clearing browser data:', error);
    return false;
  }
}

// Enhanced page creation with anti-detection measures
export async function createStealthPage(browser) {
  const page = await browser.newPage();
  const userAgent = getRandomUserAgent();
  
  // Set random user agent
  await page.setUserAgent(userAgent);
  
  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1'
  });
  
  // Inject anti-detection scripts
  await page.evaluateOnNewDocument(() => {
    // Override navigator properties
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    
    // Add fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          0: { type: 'application/x-google-chrome-pdf' },
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          length: 1,
          name: 'Chrome PDF Plugin'
        },
        {
          0: { type: 'application/pdf' },
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          length: 1,
          name: 'Chrome PDF Viewer'
        }
      ]
    });
    
    // Add WebGL vendor and renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Open Source Technology Center';
      if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics (Skylake GT2)';
      return getParameter.apply(this, arguments);
    };
  });
  
  return page;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced navigation function with retry logic
export async function customNavigate(page, url, maxRedirects = 3, maxRetries = 3) {
  let currentUrl = url;
  let redirectCount = 0;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Add random delay before navigation
      await delay(Math.floor(Math.random() * 2000) + 1000);
      
      redirectCount = 0;
      while (redirectCount < maxRedirects) {
        const response = await page.goto(currentUrl, {
          waitUntil: ['domcontentloaded', 'networkidle0'],
          timeout: 15000,
        });
        
        if (!response) {
          throw new Error('Navigation failed');
        }
        
        const newUrl = response.url();
        if (newUrl === currentUrl || newUrl === 'about:blank') break;
        
        currentUrl = newUrl;
        redirectCount++;
        
        // Random delay between redirects
        await delay(Math.floor(Math.random() * 1000) + 500);
      }
      
      return currentUrl;
    } catch (error) {
      console.error(`Navigation error (attempt ${retryCount + 1}/${maxRetries}):`, error.message);
      retryCount++;
      
      if (retryCount === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      await delay(Math.pow(2, retryCount) * 1000);
    }
  }
}