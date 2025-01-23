import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getProxyEnabledBrowserOptions } from './proxy-integration.js';

// Advanced User Agent Management
class UserAgentManager {
  constructor(userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
  ]) {
    this.userAgents = userAgents;
    this.lastUsedIndex = -1;
  }

  getRandomUserAgent() {
    // Rotate through user agents to avoid suspicion
    this.lastUsedIndex = (this.lastUsedIndex + 1) % this.userAgents.length;
    return this.userAgents[this.lastUsedIndex];
  }

  // Method to add more user agents dynamically
  addUserAgent(userAgent) {
    if (!this.userAgents.includes(userAgent)) {
      this.userAgents.push(userAgent);
    }
  }
}

// Enhanced Browser Configuration
export const browserOptions = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
    '--window-size=1920,1080',
    '--start-maximized',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-gpu',
    '--incognito',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas', 
    '--disable-extensions',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync'
  ],
  ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
  defaultViewport: {
    width: 1920,
    height: 1080
  }
};

// Stealth and Anti-Detection Configuration
const userAgentManager = new UserAgentManager();

// Configure stealth plugin with advanced evasion
const configureStealth = () => {
  const stealth = StealthPlugin();
  
  // Selectively disable some evasions for performance
  const evasionsToDisable = [
    'chrome.runtime', 
    'iframe.contentWindow', 
    'navigator.webdriver'
  ];
  
  evasionsToDisable.forEach(evasion => {
    if (stealth.enabledEvasions.has(evasion)) {
      stealth.enabledEvasions.delete(evasion);
    }
  });

  puppeteer.use(stealth);
  return stealth;
};

// Enhanced Page Creation with Anti-Detection Measures
export async function createStealthPage(browser) {
  const page = await browser.newPage();
  const userAgent = userAgentManager.getRandomUserAgent();
  
  // Set random user agent
  await page.setUserAgent(userAgent);
  
  // Set comprehensive extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  });
  
  // Advanced anti-detection script injection
  await page.evaluateOnNewDocument(() => {
    // Override navigator properties
    Object.defineProperties(navigator, {
      webdriver: { get: () => undefined },
      language: { get: () => 'en-US' },
      languages: { get: () => ['en-US', 'en'] },
      platform: { get: () => 'Win32' }
    });
    
    // Add fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          name: 'Chrome PDF Plugin',
          length: 1
        },
        {
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          name: 'Chrome PDF Viewer',
          length: 1
        }
      ]
    });
    
    // Modify WebGL fingerprint
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      const randomVendor = 'Intel Open Source Technology Center';
      const randomRenderer = 'Mesa DRI Intel(R) HD Graphics (Skylake GT2)';
      
      if (parameter === 37445) return randomVendor;
      if (parameter === 37446) return randomRenderer;
      return getParameter.apply(this, arguments);
    };
  });
  
  return page;
}

// Enhanced Navigation Function with Advanced Retry Logic
export async function customNavigate(page, url, options = {}) {
  const {
    maxRedirects = 3,
    maxRetries = 3,
    baseDelay = 1000,
    timeout = 15000
  } = options;

  let currentUrl = url;
  let redirectCount = 0;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Implement progressive delay with jitter
      const delay = baseDelay * Math.pow(2, retryCount) + 
        Math.floor(Math.random() * 500);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      redirectCount = 0;
      while (redirectCount < maxRedirects) {
        const response = await page.goto(currentUrl, {
          waitUntil: ['domcontentloaded', 'networkidle0'],
          timeout
        });
        
        if (!response) {
          throw new Error('Navigation failed');
        }
        
        const newUrl = response.url();
        if (newUrl === currentUrl || newUrl === 'about:blank') break;
        
        currentUrl = newUrl;
        redirectCount++;
        
        // Random delay between redirects
        await new Promise(resolve => 
          setTimeout(resolve, Math.floor(Math.random() * 1000) + 500)
        );
      }
      
      return currentUrl;
    } catch (error) {
      console.warn(`Navigation error (attempt ${retryCount + 1}/${maxRetries}):`, 
        error.message);
      
      retryCount++;
      
      if (retryCount === maxRetries) {
        throw error;
      }
    }
  }
}

// Browser Data Clearing Utility
export async function clearBrowserData(page) {
  try {
    const client = await page.target().createCDPSession();
    
    // Clear network-related data
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    // Clear storage and persistent data
    await page.evaluate(() => {
      // Clear various storage mechanisms
      try {
        localStorage.clear();
        sessionStorage.clear();
        
        // Clear IndexedDB
        const dbRequest = indexedDB.databases();
        dbRequest.onsuccess = (event) => {
          const databases = event.target.result;
          databases.forEach(db => {
            indexedDB.deleteDatabase(db.name);
          });
        };
        
        // Clear service workers
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => {
              registration.unregister();
            });
          });
        }
      } catch (error) {
        console.error('Error clearing browser data:', error);
      }
    });
    
    return true;
  } catch (error) {
    console.error('Comprehensive browser data clearing failed:', error);
    return false;
  }
}

// Initialize stealth configuration
configureStealth();

// Export utility for getting browser options with proxy
export function getBrowserOptions(additionalOptions = {}) {
  return {
    ...browserOptions,
    ...additionalOptions,
    args: [
      ...browserOptions.args,
      ...(additionalOptions.args || [])
    ]
  };
}

// Graceful shutdown utility
export async function gracefulBrowserShutdown(browser) {
  if (!browser) return;
  
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      await page.close();
    }
    await browser.close();
  } catch (error) {
    console.error('Error during graceful browser shutdown:', error);
  }
}

// Export the configured user agent manager for external use if needed
export const browserUserAgentManager = userAgentManager;