import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { convertToDirectUrl } from '../utils/url-converter.js';
import fetch from 'node-fetch';

const videoStore = new Map();
let browserInstance = null;

// ScraperAPI configuration
const SCRAPER_API_KEY = '169e05c208dcbe5e453edd9c5957cc40';
const SCRAPER_API_URL = 'https://api.scraperapi.com';

// Proxy configuration
const proxyList = [
  '104.207.47.0:3128',
  '156.228.83.87:3128',
  '104.207.52.169:3128',
  '156.228.80.24:3128',
  '156.233.75.196:3128',
  '156.228.177.243:3128',
  '156.228.80.196:3128',
  '104.207.37.58:3128',
  '154.94.15.217:3128',
  '156.228.185.180:3128',
  '156.228.77.3:3128',
  '156.233.73.71:3128',
  '156.253.176.188:3128',
  '156.228.87.141:3128',
  '156.233.94.57:3128',
  '154.213.197.37:3128',
  '156.228.92.24:3128',
  '156.228.180.190:3128',
  '156.228.110.54:3128',
  '104.207.58.184:3128',
  '154.213.194.173:3128',
  '154.94.13.244:3128',
  '104.167.25.208:3128',
  '156.228.109.8:3128',
  '104.207.58.230:3128',
  '156.228.116.161:3128',
  '156.228.104.104:3128',
  '156.253.178.140:3128',
  '104.167.30.212:3128',
  '156.228.83.8:3128',
  '156.253.172.183:3128',
  '156.228.113.126:3128',
  '156.228.91.154:3128',
  '156.228.0.249:3128',
  '156.253.177.212:3128',
  '104.207.63.85:3128',
  '156.228.85.108:3128',
  '156.228.99.89:3128',
  '156.233.88.176:3128',
  '156.228.80.66:3128',
  '156.249.138.247:3128',
  '104.167.24.128:3128',
  '104.207.44.209:3128',
  '104.207.40.106:3128',
  '156.253.169.219:3128',
  '154.213.193.62:3128',
  '156.228.102.4:3128',
  '156.233.92.72:3128',
  '154.94.15.106:3128',
  '156.228.183.105:3128',
  '156.228.183.125:3128',
  '156.228.91.219:3128',
  '156.228.87.139:3128',
  '156.228.175.68:3128',
  '156.228.124.136:3128',
  '156.228.85.218:3128',
  '156.228.119.27:3128',
  '154.213.196.218:3128',
  '156.233.72.45:3128',
  '156.253.169.137:3128',
  '156.228.112.41:3128',
  '156.233.74.226:3128',
  '156.233.89.227:3128',
  '156.228.82.182:3128',
  '156.233.92.186:3128',
  '104.167.31.126:3128',
  '156.228.176.161:3128',
  '156.228.87.32:3128',
  '156.228.88.129:3128',
  '156.228.99.63:3128',
  '104.207.56.38:3128',
  '156.233.73.33:3128',
  '156.228.78.164:3128',
  '104.207.54.126:3128',
  '104.207.53.85:3128',
  '156.233.72.33:3128',
  '156.228.179.198:3128',
  '104.167.25.99:3128',
  '156.228.76.208:3128',
  '156.228.174.11:3128',
  '154.213.199.233:3128',
  '156.228.76.13:3128',
  '156.233.91.117:3128',
  '156.228.106.13:3128',
  '156.228.184.136:3128',
  '104.207.56.23:3128',
  '154.213.195.158:3128',
  '156.228.106.201:3128',
  '154.94.13.132:3128',
  '154.213.203.125:3128',
  '156.228.119.45:3128',
  '156.228.0.198:3128',
  '156.228.84.234:3128',
  '104.207.54.239:3128',
  '156.228.78.234:3128',
  '104.207.62.97:3128',
  '45.202.77.125:3128',
  '104.207.34.66:3128',
  '156.253.173.62:3128',
  '156.233.89.115:3128'
];

// Proxy rotation system
let currentProxyIndex = 0;
function getNextProxy() {
  const proxy = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  return proxy;
}

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

// Browser management with proxy support and error handling
async function getBrowser(retryCount = 0) {
  try {
    if (!browserInstance || !browserInstance.isConnected()) {
      const proxy = getNextProxy();
      console.log(`[Browser] Creating new browser instance with proxy: ${proxy}`);
      
      browserInstance = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          `--proxy-server=http://${proxy}`
        ]
      });
    }
    return browserInstance;
  } catch (error) {
    console.error('[Browser] Launch error:', error);
    browserInstance = null;
    
    // Retry with a different proxy if the current one fails
    if (retryCount < proxyList.length) {
      console.log(`[Browser] Retrying with different proxy (attempt ${retryCount + 1}/${proxyList.length})`);
      return getBrowser(retryCount + 1);
    }
    
    throw new Error('All proxies failed, unable to create browser instance');
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

async function getVideoUrl(page, embedUrl, retryCount = 0) {
  const startTime = performance.now();
  console.log('\n[Browser] Starting request tracking for:', embedUrl);
  
  let apiResponseData = null;
  let responseUrl = null;
  let apiResponseTime = null;

  try {
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
    
    // Try with a different proxy if the current one fails
    if (retryCount < Math.min(5, proxyList.length - 1)) { // Limit retries to 5 or the proxy list length
      console.log(`[Browser] Retrying with a different proxy (attempt ${retryCount + 1})`);
      
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
      const browser = await getBrowser();
      const newPage = await browser.newPage();
      
      // Retry with the new page
      return getVideoUrl(newPage, embedUrl, retryCount + 1);
    }
    
    // If all proxies fail, try using ScraperAPI as a last resort
    console.log('[Browser] All proxies failed, attempting fallback to ScraperAPI');
    try {
      return await getVideoDataWithScraperAPI(embedUrl);
    } catch (scraperError) {
      console.error('[ScraperAPI] Fallback failed:', scraperError.message);
      throw new Error(`All methods failed: ${error.message}, ScraperAPI: ${scraperError.message}`);
    }
  }
}

// Function to fetch data using ScraperAPI
async function fetchWithScraperAPI(url) {
  console.log('[ScraperAPI] Attempting to fetch URL:', url);
  const apiUrl = `${SCRAPER_API_URL}?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
  
  try {
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`ScraperAPI returned status ${response.status}`);
    }
    
    const html = await response.text();
    console.log('[ScraperAPI] Successfully fetched data');
    return html;
  } catch (error) {
    console.error('[ScraperAPI] Error:', error.message);
    throw error;
  }
}

// Function to extract API data from embed page using ScraperAPI
async function getVideoDataWithScraperAPI(embedUrl) {
  console.log('[ScraperAPI] Starting data extraction for:', embedUrl);
  const startTime = performance.now();
  
  try {
    const html = await fetchWithScraperAPI(embedUrl);
    
    // Look for the API URL pattern in the HTML
    const apiUrlPattern = /\/api\/b\/(movie|tv)\/[^'"]+/;
    const match = html.match(apiUrlPattern);
    
    if (!match) {
      throw new Error('API URL not found in the page');
    }
    
    // Extract the API URL and fetch it
    const apiUrl = `https://vidlink.pro${match[0]}`;
    console.log('[ScraperAPI] Found API URL:', apiUrl);
    
    // Fetch the API data
    const apiData = await fetchWithScraperAPI(apiUrl);
    let jsonData;
    
    try {
      jsonData = JSON.parse(apiData);
    } catch (e) {
      throw new Error('Failed to parse API response as JSON');
    }
    
    // Process the API response
    const results = await processApiResponse(jsonData);
    
    if (results.length === 0) {
      throw new Error('No valid video sources found');
    }
    
    console.log(`[ScraperAPI] Total time: ${getTimeDiff(startTime)}`);
    
    return {
      results,
      apiUrl,
      timing: {
        total: getTimeDiff(startTime)
      }
    };
    
  } catch (error) {
    console.error('[ScraperAPI] Extraction error:', error.message);
    throw error;
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
        method: error.message.includes('ScraperAPI') ? 'Both proxy and ScraperAPI failed' : 'Proxy failed',
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