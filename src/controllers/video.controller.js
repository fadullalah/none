import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { convertToDirectUrl } from '../utils/url-converter.js';
import fetch from 'node-fetch';
import { createClient } from 'redis';

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
    }
  }
}

// Persistent browser instance
let browserInstance = null;
// Browser page pool for reuse
const pagePool = [];
const MAX_POOL_SIZE = 3;

// Redis client setup
const redisClient = createClient({
  url: process.env.REDIS_URL // Railway automatically adds this environment variable
});

// Connect to Redis and handle errors
(async () => {
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  await redisClient.connect();
  console.log('Connected to Redis');
})();

// Cache TTL settings
const CACHE_TTL = 86400; // 24 hours in seconds
const STORE_TTL = 3600;  // 1 hour in seconds

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

// Get a page from the pool or create a new one
async function getPage() {
  // Initialize browser if needed
  if (!browserInstance) {
    initializeStealthPlugin();
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--js-flags=--expose-gc',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-web-security',
        '--disable-extensions',
        '--window-size=1920,1080'
      ],
      ignoreHTTPSErrors: true
    };
    
    console.log('[Browser] Creating persistent browser instance');
    browserInstance = await puppeteer.launch(launchOptions);
  }
  
  // Get page from pool or create new
  if (pagePool.length > 0) {
    const page = pagePool.pop();
    try {
      // Reset page state
      await page.goto('about:blank');
      return page;
    } catch (e) {
      console.log('[Browser] Recycled page error, creating new page');
      try { await page.close(); } catch (err) {}
      // Continue to create new page
    }
  }
  
  // Create new page
  return await browserInstance.newPage();
}

// Return page to pool for reuse
async function releasePage(page) {
  if (!page) return;
  
  try {
    if (pagePool.length < MAX_POOL_SIZE) {
      // Reset page state
      await page.evaluate(() => {
        if (window.gc) window.gc();
      });
      await page.removeAllListeners();
      pagePool.push(page);
      console.log(`[Browser] Page returned to pool. Pool size: ${pagePool.length}`);
    } else {
      await page.close();
    }
  } catch (e) {
    console.error('[Browser] Error releasing page:', e.message);
    try { await page.close(); } catch (err) {}
  }
}

// Direct API request - now the primary method for speed
async function getVideoUrlDirect(url) {
  const startTime = performance.now();
  console.log(`[Direct] Making direct API request for: ${url}`);
  
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
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
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
        throw new Error('Direct API request timed out after 15 seconds');
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

// Browser method as fallback when direct API fails
async function getVideoUrlBrowser(page, embedUrl) {
  const startTime = performance.now();
  console.log('\n[Browser] Starting request tracking for:', embedUrl);
  
  let apiResponseData = null;
  let responseUrl = null;
  let apiResponseTime = null;

  try {
    // More aggressive request blocking
    await page.setRequestInterception(true);
    page.on('request', request => {
      const resourceType = request.resourceType();
      const url = request.url();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType) || 
          url.includes('google') || 
          url.includes('analytics') || 
          url.includes('facebook') || 
          url.includes('tracker')) {
        request.abort();
        return;
      }
      
      if (url.includes('/api/b/movie') || url.includes('/api/b/tv')) {
        console.log('[Browser] Detected API request:', url);
      }
      request.continue();
    });

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API response timeout'));
      }, 15000); // 15 second timeout

      page.on('response', async response => {
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
      });
    });

    // Add error handlers
    page.on('error', err => console.error('[Browser] Page error:', err.message));
    page.on('pageerror', err => console.error('[Browser] Page error in browser context:', err.message));

    // Navigate to page with shorter timeout
    console.log('[Browser] Navigating to page');
    await Promise.race([
      page.goto(embedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 10000
      }),
      responsePromise
    ]).catch(err => {
      // If navigation fails but we still get an API response, we can continue
      if (!apiResponseData) throw err;
    });

    // Wait for the API response if not already received
    const data = apiResponseData || await responsePromise;
    
    // Process response
    const results = await processApiResponse(data);
    
    if (results.length > 0) {
      console.log(`[Time] Browser processing time: ${getTimeDiff(startTime)}`);
      return { 
        results,
        apiUrl: responseUrl,
        timing: {
          total: getTimeDiff(startTime),
          apiResponse: apiResponseTime,
          method: 'browser'
        }
      };
    }
    
    throw new Error('No valid video sources found from browser');
  } catch (error) {
    console.error('[Browser] Error:', error.message);
    throw error;
  }
}

// Race between direct and browser methods (modified to try browser first)
async function getVideoWithFallback(embedUrl) {
  // Try the browser method first since direct API has issues
  let page = null;
  try {
    page = await getPage();
    return await getVideoUrlBrowser(page, embedUrl);
  } catch (browserError) {
    console.error(`[Controller] Browser method failed: ${browserError.message}`);
    
    // Fall back to direct API as a last resort
    try {
      console.log(`[Controller] Trying direct API as fallback`);
      return await getVideoUrlDirect(embedUrl);
    } catch (directError) {
      console.error(`[Controller] Direct API also failed: ${directError.message}`);
      throw new Error(`All methods failed. Browser: ${browserError.message}. Direct: ${directError.message}`);
    }
  } finally {
    if (page) await releasePage(page);
  }
}

export const videoController = {
  async getVideoUrlFromEmbed(req, res) {
    const totalStartTime = performance.now();
    const { embedUrl } = req.query;
    if (!embedUrl) return res.status(400).json({ error: 'Embed URL required' });

    // Check Redis cache first
    try {
      const cachedData = await redisClient.get(`videoCache:${embedUrl}`);
      
      if (cachedData) {
        console.log(`[Cache] Serving cached response for: ${embedUrl}`);
        
        // Generate a new unique ID for this watch session
        const uniqueId = uuidv4();
        const parsedData = JSON.parse(cachedData);
        
        // Store the watch URL in Redis with TTL
        await redisClient.set(
          `videoStore:${uniqueId}`, 
          parsedData.results[0].video_urls[0], 
          { EX: STORE_TTL }
        );
        
        return res.json({
          ...parsedData,
          watchUrl: `${process.env.BASE_URL}/watch/${uniqueId}`,
          timing: {
            ...parsedData.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      }
    } catch (cacheError) {
      console.error(`[Cache] Error reading from cache: ${cacheError.message}`);
      // Continue with fetching if cache fails
    }
    
    try {
      // Try direct API first, with browser fallback
      const data = await getVideoWithFallback(embedUrl);
      
      if (data.results?.length > 0) {
        const uniqueId = uuidv4();
        
        try {
          // Store with expiry time in Redis
          await redisClient.set(
            `videoStore:${uniqueId}`, 
            data.results[0].video_urls[0], 
            { EX: STORE_TTL }
          );
          
          // Store in Redis cache with TTL
          await redisClient.set(
            `videoCache:${embedUrl}`, 
            JSON.stringify(data), 
            { EX: CACHE_TTL }
          );
        } catch (redisError) {
          console.error(`[Cache] Error writing to Redis: ${redisError.message}`);
          // Continue even if caching fails
        }
        
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
      console.error(`[Controller] Fatal error in getVideoUrlFromEmbed: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to fetch video data', 
        details: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    }
  },

  async getTVEpisode(req, res) {
    const totalStartTime = performance.now();
    const { id, season, episode } = req.params;
    
    // Check Redis cache first
    const cacheKey = `videoCache:tv:${id}:${season}:${episode}`;
    try {
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        console.log(`[Cache] Serving cached response for: ${cacheKey}`);
        const parsedData = JSON.parse(cachedData);
        
        return res.json({
          status: 'success',
          ...parsedData,
          timing: {
            ...parsedData.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      }
    } catch (cacheError) {
      console.error(`[Cache] Error reading from cache: ${cacheError.message}`);
    }
    
    try {
      const url = `https://vidlink.pro/tv/${id}/${season}/${episode}`;
      const data = await getVideoWithFallback(url);
      
      // Store in Redis cache
      try {
        await redisClient.set(
          cacheKey, 
          JSON.stringify(data), 
          { EX: CACHE_TTL }
        );
      } catch (redisError) {
        console.error(`[Cache] Error writing to Redis: ${redisError.message}`);
      }
      
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
      console.error(`[Controller] Error in getTVEpisode: ${error.message}`);
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    }
  },

  async getMovie(req, res) {
    const totalStartTime = performance.now();
    const { id } = req.params;
    
    // Check Redis cache first
    const cacheKey = `videoCache:movie:${id}`;
    try {
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        console.log(`[Cache] Serving cached response for: ${cacheKey}`);
        const parsedData = JSON.parse(cachedData);
        
        return res.json({
          status: 'success',
          ...parsedData,
          timing: {
            ...parsedData.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      }
    } catch (cacheError) {
      console.error(`[Cache] Error reading from cache: ${cacheError.message}`);
    }
    
    try {
      const url = `https://vidlink.pro/movie/${id}`;
      const data = await getVideoWithFallback(url);
      
      // Store in Redis cache
      try {
        await redisClient.set(
          cacheKey, 
          JSON.stringify(data), 
          { EX: CACHE_TTL }
        );
      } catch (redisError) {
        console.error(`[Cache] Error writing to Redis: ${redisError.message}`);
      }
      
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
      console.error(`[Controller] Error in getMovie: ${error.message}`);
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    }
  },
  
  // Add an endpoint to watch videos using the unique ID
  async watchVideo(req, res) {
    const { id } = req.params;
    
    try {
      const videoUrl = await redisClient.get(`videoStore:${id}`);
      
      if (!videoUrl) {
        return res.status(404).json({ 
          error: 'Video not found or link expired' 
        });
      }
      
      // Redirect to the video URL or handle as needed
      res.redirect(videoUrl);
    } catch (error) {
      console.error(`[Controller] Error in watchVideo: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to retrieve video', 
        details: error.message 
      });
    }
  }
};