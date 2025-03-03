import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { convertToDirectUrl } from '../utils/url-converter.js';
import fetch from 'node-fetch';

// Configure Puppeteer with stealth plugin only once
let stealthPluginInitialized = false;
function initializeStealthPlugin() {
  if (!stealthPluginInitialized) {
    try {
      puppeteer.use(StealthPlugin());
      stealthPluginInitialized = true;
      console.log("[Browser] Stealth plugin initialized");
    } catch (error) {
      console.error("[Browser] Error initializing stealth plugin:", error.message);
      // Continue without stealth if it fails
    }
  }
}

const videoStore = new Map();
let browserInstance = null;

const PROXY_LIST = [
  '104.207.47.0:3128',
  '156.228.80.24:3128',
  '156.233.75.196:3128',
  '156.228.177.243:3128',
  '156.228.80.196:3128',
  '104.207.37.58:3128',
  '154.94.15.217:3128',
  '156.228.185.180:3128',
  '156.228.77.3:3128',
  '156.233.73.71:3128',
  '156.253.176.188:3128'
];

// Get a random proxy from the list
function getRandomProxy() {
  const randomIndex = Math.floor(Math.random() * PROXY_LIST.length);
  const proxy = PROXY_LIST[randomIndex];
  // Add http:// prefix if not present
  return proxy.startsWith('http') ? proxy : `http://${proxy}`;
}

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

// Direct API request fallback when all proxies fail
async function getVideoUrlDirect(url) {
  const startTime = performance.now();
  console.log(`[Direct] Attempting direct API request as fallback for: ${url}`);
  
  try {
    // Extract ID, season, and episode from the URL
    let apiUrl;
    try {
      if (url.includes('/movie/')) {
        const id = url.split('/movie/')[1].split('/')[0];
        apiUrl = `https://vidlink.pro/api/b/movie/${id}`;
      } else if (url.includes('/tv/')) {
        const parts = url.split('/tv/')[1].split('/');
        const id = parts[0];
        const season = parts[1];
        const episode = parts[2];
        apiUrl = `https://vidlink.pro/api/b/tv/${id}/${season}/${episode}`;
      } else {
        throw new Error('Unsupported URL format for direct API request');
      }
    } catch (parseError) {
      console.error(`[Direct] Failed to parse URL ${url}: ${parseError.message}`);
      throw new Error(`Unable to parse URL format: ${parseError.message}`);
    }
    
    console.log(`[Direct] Requesting API: ${apiUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
    
    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://vidlink.pro/',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }
      
      const data = await response.json();
      const results = await processApiResponse(data);
      
      console.log(`[Direct] API request successful, took: ${getTimeDiff(startTime)}`);
      
      return {
        results,
        apiUrl,
        timing: {
          total: getTimeDiff(startTime),
          method: 'direct'
        }
      };
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        throw new Error('Direct API request timed out after 20 seconds');
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error(`[Direct] API request failed: ${error.message}`);
    throw new Error(`Direct API request failed: ${error.message}`);
  }
}

// Browser management with random proxy selection and error handling
async function getBrowser(retryCount = 0, triedProxies = []) {
  try {
    // Initialize stealth plugin
    initializeStealthPlugin();
    
    // Always close the previous browser instance to use a fresh proxy
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {
        console.error('[Browser] Error closing existing browser:', e.message);
      }
      browserInstance = null;
    }
    
    // Browser launch options
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      ignoreHTTPSErrors: true
    };
    
    // If retry count exceeds threshold or we've tried enough proxies, launch without proxy
    if (retryCount >= Math.min(3, PROXY_LIST.length - 1)) {
      console.log('[Browser] Trying without proxy as fallback');
      browserInstance = await puppeteer.launch(launchOptions);
      return browserInstance;
    }
    
    // Select a random proxy that hasn't been tried yet in this retry sequence
    let proxy = getRandomProxy();
    while (triedProxies.includes(proxy) && triedProxies.length < PROXY_LIST.length) {
      proxy = getRandomProxy();
    }
    triedProxies.push(proxy);
    
    console.log(`[Browser] Creating new browser instance with proxy: ${proxy}`);
    
    // Add proxy to launch args
    launchOptions.args.push(`--proxy-server=${proxy}`);
    
    browserInstance = await puppeteer.launch(launchOptions);
    return browserInstance;
  } catch (error) {
    console.error('[Browser] Launch error:', error.toString());
    
    // Ensure browser is completely closed
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {
        console.error('[Browser] Error closing browser:', e.message);
      }
      browserInstance = null;
    }
    
    // If all proxies fail, try without proxy
    console.log('[Browser] Launch failed, trying without proxy');
    try {
      browserInstance = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ],
        ignoreHTTPSErrors: true
      });
      return browserInstance;
    } catch (fallbackError) {
      console.error('[Browser] Fallback launch error:', fallbackError.toString());
      throw new Error('Unable to create browser instance: ' + fallbackError.message);
    }
  }
}

async function processApiResponse(data) {
  const startTime = performance.now();
  const results = [];
  
  if (data.stream && data.stream.playlist) {
    const videoUrl = data.stream.playlist;
    const subtitles = (data.stream.captions || []).map(caption => ({
      label: caption.language,
      file: caption.url
    }));

    results.push({
      video_urls: [videoUrl],
      subtitles: subtitles,
      qualities: {
        '1080': `${videoUrl.split('playlist.m3u8')[0]}1080/index.m3u8`,
        '720': `${videoUrl.split('playlist.m3u8')[0]}720/index.m3u8`,
        '480': `${videoUrl.split('playlist.m3u8')[0]}480/index.m3u8`,
        '360': `${videoUrl.split('playlist.m3u8')[0]}360/index.m3u8`
      }
    });
  } else if (data.source) {
    if (Array.isArray(data.source)) {
      data.source.forEach(src => {
        if (src.file) results.push({
          video_urls: [convertToDirectUrl(src.file)],
          subtitles: data.track || []
        });
      });
    } else if (data.source.file) {
      results.push({
        video_urls: [convertToDirectUrl(data.source.file)],
        subtitles: data.track || []
      });
    }
  }

  console.log(`[Time] Response processing took: ${getTimeDiff(startTime)}`);
  return results;
}

async function getVideoUrl(page, embedUrl, retryCount = 0, triedProxies = []) {
  const startTime = performance.now();
  console.log('\n[Browser] Starting request tracking for:', embedUrl);
  
  let apiResponseData = null;
  let responseUrl = null;
  let apiResponseTime = null;

  try {
    // Wait a moment before interacting with the page to ensure it's ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Set up request interception
    try {
      await page.setRequestInterception(true);
    } catch (interceptError) {
      console.error('[Browser] Error setting up request interception:', interceptError.message);
      // Continue without interception if it fails
    }

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API response timeout'));
      }, 20000); // 20 second timeout

      page.on('request', request => {
        try {
          const resourceType = request.resourceType();
          if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            request.abort();
            return;
          }
          
          const url = request.url();
          if (url.includes('/api/b/movie') || url.includes('/api/b/tv')) {
            console.log('[Browser] Detected API request:', url);
          }
          request.continue();
        } catch (requestError) {
          console.error('[Browser] Error handling request:', requestError.message);
          try {
            request.continue();
          } catch (continueError) {
            // Ignore continue errors
          }
        }
      });

      page.on('response', async response => {
        try {
          const url = response.url();
          if (url.includes('/api/b/movie') || url.includes('/api/b/tv')) {
            try {
              const responseStartTime = performance.now();
              responseUrl = url;
              const data = await response.json();
              apiResponseTime = getTimeDiff(responseStartTime);
              console.log(`[Browser] API response captured in: ${apiResponseTime}`);
              apiResponseData = data;
              clearTimeout(timeout);
              resolve(data);
            } catch (jsonError) {
              console.log('[Browser] Failed to parse API response:', jsonError.message);
            }
          }
        } catch (responseError) {
          console.error('[Browser] Error handling response:', responseError.message);
        }
      });
    });

    // Add error handlers
    page.on('error', err => {
      console.error('[Browser] Page error:', err.message);
    });
    
    page.on('pageerror', err => {
      console.error('[Browser] Page error in browser context:', err.message);
    });

    // Navigate to page with shorter timeout
    console.log('[Browser] Navigating to page');
    const navigationStartTime = performance.now();
    
    try {
      await Promise.race([
        page.goto(embedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        }),
        responsePromise
      ]);
    } catch (navigationError) {
      console.error('[Browser] Navigation error:', navigationError.message);
      // If navigation fails but we still get an API response, we can continue
      if (!apiResponseData) {
        throw navigationError;
      }
    }

    console.log(`[Time] Navigation took: ${getTimeDiff(navigationStartTime)}`);

    // Wait for the API response if not already received
    const data = apiResponseData || await responsePromise;
    
    // Process response
    const results = await processApiResponse(data);
    
    if (results.length > 0) {
      console.log(`[Time] Total processing time: ${getTimeDiff(startTime)}`);
      return { 
        results,
        apiUrl: responseUrl,
        timing: {
          total: getTimeDiff(startTime),
          apiResponse: apiResponseTime
        }
      };
    }
    
    throw new Error('No valid video sources found');

  } catch (error) {
    console.error('[Browser] Error:', error.message);
    
    // Try again with a different proxy or without proxy
    if (retryCount < Math.min(3, PROXY_LIST.length - 1)) {
      console.log(`[Browser] Retrying request with different proxy or without proxy (attempt ${retryCount + 1}/3)`);
      
      // Close the current page and browser
      try {
        await page.close();
      } catch (e) {
        console.error('[Browser] Error closing page:', e.message);
      }
      
      try {
        if (browserInstance) {
          await browserInstance.close();
          browserInstance = null;
        }
      } catch (e) {
        console.error('[Browser] Error closing browser:', e.message);
        browserInstance = null;
      }
      
      // Get a new browser (might be without proxy if retries exceeded)
      const browser = await getBrowser(retryCount + 1, triedProxies);
      const newPage = await browser.newPage();
      
      // Retry with the new page
      return getVideoUrl(newPage, embedUrl, retryCount + 1, triedProxies);
    }
    
    // No more retries, throw the original error
    throw new Error(`Failed to extract video data: ${error.message}`);
  }
}

export const videoController = {
  async getVideoUrlFromEmbed(req, res) {
    const totalStartTime = performance.now();
    const { embedUrl } = req.query;
    if (!embedUrl) return res.status(400).json({ error: 'Embed URL required' });

    let page = null;
    
    try {
      const browserStartTime = performance.now();
      const browser = await getBrowser();
      console.log(`[Time] Browser get/launch took: ${getTimeDiff(browserStartTime)}`);

      page = await browser.newPage();
      
      // Try Puppeteer (with or without proxy, handled by getBrowser)
      const data = await getVideoUrl(page, embedUrl);
      
      if (data.results?.length > 0) {
        const uniqueId = uuidv4();
        videoStore.set(uniqueId, data.results[0].video_urls[0]);
        console.log(`[Time] Total request time: ${getTimeDiff(totalStartTime)}`);
        res.json({ 
          ...data,
          watchUrl: `${process.env.BASE_URL}/watch/${uniqueId}`,
          timing: {
            ...data.timing,
            total: getTimeDiff(totalStartTime)
          }
        });
      } else {
        res.status(404).json({ error: 'No video data found' });
      }
    } catch (error) {
      console.error(`[Controller] Fatal error in getVideoUrlFromEmbed: ${error.message}`, error);
      // Always respond with a meaningful error, no matter what happens
      res.status(500).json({ 
        error: 'Failed to fetch video data', 
        details: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('[Browser] Error closing page:', e.message);
        }
      }
    }
  },

  async getTVEpisode(req, res) {
    const totalStartTime = performance.now();
    const { id, season, episode } = req.params;
    let page = null;
    
    try {
      const url = `https://vidlink.pro/tv/${id}/${season}/${episode}`;
      const browser = await getBrowser();
      page = await browser.newPage();
      const data = await getVideoUrl(page, url);
      
      console.log(`[Time] Total request time: ${getTimeDiff(totalStartTime)}`);
      res.json({ 
        status: 'success',
        ...data,
        timing: {
          ...data.timing,
          total: getTimeDiff(totalStartTime)
        }
      });
    } catch (error) {
      console.error(`[Controller] Error in getTVEpisode: ${error.message}`, error);
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('[Browser] Error closing page:', e.message);
        }
      }
    }
  },

  async getMovie(req, res) {
    const totalStartTime = performance.now();
    const { id } = req.params;
    let page = null;
    
    try {
      const url = `https://vidlink.pro/movie/${id}`;
      const browser = await getBrowser();
      page = await browser.newPage();
      const data = await getVideoUrl(page, url);
      
      console.log(`[Time] Total request time: ${getTimeDiff(totalStartTime)}`);
      res.json({ 
        status: 'success',
        ...data,
        timing: {
          ...data.timing,
          total: getTimeDiff(totalStartTime)
        }
      });
    } catch (error) {
      console.error(`[Controller] Error in getMovie: ${error.message}`, error);
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('[Browser] Error closing page:', e.message);
        }
      }
    }
  }
};