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
    }
  }
}

// Persistent browser instance
let browserInstance = null;
// Browser page pool for reuse
const pagePool = [];
const MAX_POOL_SIZE = 3;

// Add a cache with longer TTL for video data
const videoCache = new Map();
const videoStore = new Map();
const CACHE_TTL = 86400000; // 24 hours in milliseconds
const MAX_CACHE_SIZE = 1000; // Maximum number of items in cache
const STORE_TTL = 3600000; // 1 hour TTL for videoStore items

// Add cache cleanup function
function cleanupCaches() {
  const now = Date.now();
  
  // Clean videoCache
  let expiredCount = 0;
  for (const [key, value] of videoCache.entries()) {
    if (value.expiry < now) {
      videoCache.delete(key);
      expiredCount++;
    }
  }
  
  // Clean videoStore
  let expiredStoreCount = 0;
  for (const [key, value] of videoStore.entries()) {
    if (value.expiry < now) {
      videoStore.delete(key);
      expiredStoreCount++;
    }
  }
  
  if (expiredCount > 0 || expiredStoreCount > 0) {
    console.log(`[Cache] Cleanup: Removed ${expiredCount} expired cache entries and ${expiredStoreCount} expired store entries`);
  }
  
  // Implement LRU-like eviction if cache is too large
  if (videoCache.size > MAX_CACHE_SIZE) {
    // Sort by expiry and remove oldest
    const sortedEntries = [...videoCache.entries()]
      .sort((a, b) => a[1].expiry - b[1].expiry);
    
    const entriesToRemove = sortedEntries.slice(0, videoCache.size - MAX_CACHE_SIZE);
    for (const [key] of entriesToRemove) {
      videoCache.delete(key);
    }
    console.log(`[Cache] Size limit reached: Evicted ${entriesToRemove.length} oldest entries`);
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupCaches, 15 * 60 * 1000);

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

    // Check cache first
    if (videoCache.has(embedUrl)) {
      const cachedData = videoCache.get(embedUrl);
      if (cachedData.expiry > Date.now()) {
        console.log(`[Cache] Serving cached response for: ${embedUrl}`);
        
        // Generate a new unique ID for this watch session
        const uniqueId = uuidv4();
        videoStore.set(uniqueId, cachedData.data.results[0].video_urls[0]);
        
        return res.json({
          ...cachedData.data,
          watchUrl: `${process.env.BASE_URL}/watch/${uniqueId}`,
          timing: {
            ...cachedData.data.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      } else {
        console.log(`[Cache] Expired cache for: ${embedUrl}`);
        videoCache.delete(embedUrl);
      }
    }
    
    try {
      // Try direct API first, with browser fallback
      const data = await getVideoWithFallback(embedUrl);
      
      if (data.results?.length > 0) {
        const uniqueId = uuidv4();
        // Store with expiry time
        videoStore.set(uniqueId, {
          url: data.results[0].video_urls[0],
          expiry: Date.now() + STORE_TTL
        });
        
        // Store in cache
        videoCache.set(embedUrl, {
          data,
          expiry: Date.now() + CACHE_TTL
        });
        
        // Run cleanup if cache is getting large
        if (videoCache.size > MAX_CACHE_SIZE * 0.9) {
          cleanupCaches();
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
    
    // Check cache first
    const cacheKey = `https://vidlink.pro/tv/${id}/${season}/${episode}`;
    if (videoCache.has(cacheKey)) {
      const cachedData = videoCache.get(cacheKey);
      if (cachedData.expiry > Date.now()) {
        console.log(`[Cache] Serving cached response for: ${cacheKey}`);
        return res.json({
          status: 'success',
          ...cachedData.data,
          timing: {
            ...cachedData.data.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      } else {
        console.log(`[Cache] Expired cache for: ${cacheKey}`);
        videoCache.delete(cacheKey);
      }
    }
    
    try {
      const url = `https://vidlink.pro/tv/${id}/${season}/${episode}`;
      const data = await getVideoWithFallback(url);
      
      // Store in cache
      videoCache.set(cacheKey, {
        data,
        expiry: Date.now() + CACHE_TTL
      });
      
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
    
    // Check cache first
    const cacheKey = `https://vidlink.pro/movie/${id}`;
    if (videoCache.has(cacheKey)) {
      const cachedData = videoCache.get(cacheKey);
      if (cachedData.expiry > Date.now()) {
        console.log(`[Cache] Serving cached response for: ${cacheKey}`);
        return res.json({
          status: 'success',
          ...cachedData.data,
          timing: {
            ...cachedData.data.timing,
            total: getTimeDiff(totalStartTime),
            fromCache: true
          }
        });
      } else {
        console.log(`[Cache] Expired cache for: ${cacheKey}`);
        videoCache.delete(cacheKey);
      }
    }
    
    try {
      const url = `https://vidlink.pro/movie/${id}`;
      const data = await getVideoWithFallback(url);
      
      // Store in cache
      videoCache.set(cacheKey, {
        data,
        expiry: Date.now() + CACHE_TTL
      });
      
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
  }
};