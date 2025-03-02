import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { convertToDirectUrl } from '../utils/url-converter.js';
import fetch from 'node-fetch';

const videoStore = new Map();
let browserInstance = null;

// Proxy configuration - list of available proxies
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

// Browser management with random proxy selection and error handling
async function getBrowser(retryCount = 0, triedProxies = []) {
  try {
    // Always close the previous browser instance to use a fresh proxy
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {
        console.error('[Browser] Error closing existing browser:', e.message);
      }
      browserInstance = null;
    }
    
    // Select a random proxy that hasn't been tried yet in this retry sequence
    let proxy = getRandomProxy();
    while (triedProxies.includes(proxy) && triedProxies.length < PROXY_LIST.length) {
      proxy = getRandomProxy();
    }
    triedProxies.push(proxy);
    
    console.log(`[Browser] Creating new browser instance with proxy: ${proxy}`);
    
    const launchArgs = [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      `--proxy-server=${proxy}`,
      '--disable-dev-shm-usage' // Add this for Linux VPS environments
    ];
    
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
      ignoreHTTPSErrors: true  // Add this to ignore HTTPS errors that might occur with proxies
    });
    
    return browserInstance;
  } catch (error) {
    console.error('[Browser] Launch error with proxy:', error.toString());
    
    // Ensure browser is completely closed
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {
        console.error('[Browser] Error closing browser:', e.message);
      }
      browserInstance = null;
    }
    
    // Retry with a different proxy if available
    if (retryCount < Math.min(3, PROXY_LIST.length - 1)) {
      console.log(`[Browser] Retrying with different proxy (attempt ${retryCount + 1}/3)`);
      return getBrowser(retryCount + 1, triedProxies);
    }
    
    // If all proxies fail, try without proxy as fallback
    if (retryCount === Math.min(3, PROXY_LIST.length - 1)) {
      console.log('[Browser] All proxies failed, trying without proxy as fallback');
      
      try {
        browserInstance = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
          ]
        });
        return browserInstance;
      } catch (fallbackError) {
        console.error('[Browser] Fallback launch error:', fallbackError.toString());
        throw new Error('All proxies failed, unable to create browser instance');
      }
    }
    
    throw new Error('Failed to create browser instance with proxy after multiple attempts');
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
    // Configure proxy authentication if needed (commented out by default)
    // If your proxy requires authentication, uncomment and configure this:
    /*
    await page.authenticate({
      username: 'proxy-username',
      password: 'proxy-password'
    });
    */
    
    // Set up request interception
    await page.setRequestInterception(true);

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API response timeout'));
      }, 20000); // Increased timeout

      page.on('request', request => {
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
      });

      page.on('response', async response => {
        const url = response.url();
        if (url.includes('/api/b/movie') || url.includes('/api/b/tv')) {
          try {
            const responseStartTime = performance.now();
            responseUrl = url;
            // Direct request without proxy
            const data = await response.json();
            apiResponseTime = getTimeDiff(responseStartTime);
            console.log(`[Browser] API response captured in: ${apiResponseTime}`);
            apiResponseData = data;
            clearTimeout(timeout);
            resolve(data);
          } catch (e) {
            console.log('[Browser] Failed to parse API response:', e.message);
          }
        }
      });
    });

    // Navigate to page with shorter timeout
    console.log('[Browser] Navigating to page');
    const navigationStartTime = performance.now();
    
    await Promise.race([
      page.goto(embedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }),
      responsePromise
    ]);    

    console.log(`[Time] Navigation took: ${getTimeDiff(navigationStartTime)}`);

    // Wait for the API response
    const data = await responsePromise;
    
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
    
    // Try again with a different proxy
    if (retryCount < Math.min(3, PROXY_LIST.length - 1)) {
      console.log(`[Browser] Retrying request with different proxy (attempt ${retryCount + 1}/3)`);
      
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
      
      // Get a new browser with a different proxy
      const browser = await getBrowser(0, triedProxies);
      const newPage = await browser.newPage();
      
      // Retry with the new page and a different proxy
      return getVideoUrl(newPage, embedUrl, retryCount + 1, triedProxies);
    }
    
    // No more fallback options, just throw the error
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
      res.status(500).json({ 
        error: 'Failed to fetch video data', 
        details: error.message,
        method: 'Proxy failed',
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
      const browser = await getBrowser();
      page = await browser.newPage();
      const data = await getVideoUrl(page, `https://vidlink.pro/tv/${id}/${season}/${episode}`);
      
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
      const browser = await getBrowser();
      page = await browser.newPage();
      const data = await getVideoUrl(page, `https://vidlink.pro/movie/${id}`);
      
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