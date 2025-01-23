import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { browserOptions, customNavigate } from '../utils/browser.js';
import { convertToDirectUrl } from '../utils/url-converter.js';
import { withProxy } from '../utils/proxy-integration.js';

// Enhanced video store with TTL and cleanup
class VideoStoreManager {
  constructor(ttl = 60 * 60 * 1000) { // Default 1 hour TTL
    this.store = new Map();
    this.ttl = ttl;
    this.cleanupInterval = setInterval(() => this.cleanup(), 10 * 60 * 1000); // Cleanup every 10 minutes
  }

  set(key, value) {
    this.store.set(key, {
      value,
      timestamp: Date.now()
    });
    return key;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key);
      return null;
    }
    
    return entry.value;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.store.delete(key);
      }
    }
  }

  // Cleanup method to be called when shutting down
  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Browser Pool Management
class BrowserPoolManager {
  constructor(poolSize = 5, launchOptions = {}) {
    this.poolSize = poolSize;
    this.launchOptions = {
      ...browserOptions,
      ...launchOptions
    };
    this.browsers = [];
    this.availableBrowsers = [];
  }

  async initPool() {
    for (let i = 0; i < this.poolSize; i++) {
      const browser = await this.createBrowser();
      this.browsers.push(browser);
      this.availableBrowsers.push(browser);
    }
  }

  async createBrowser() {
    try {
      return await puppeteer.launch({
        ...this.launchOptions,
        args: [
          ...this.launchOptions.args,
          '--no-zygote',
          '--disable-dev-shm-usage'
        ]
      });
    } catch (error) {
      console.error('[BrowserPool] Browser launch error:', error);
      throw error;
    }
  }

  async getBrowser() {
    // If no browsers are available, wait or create a new one
    if (this.availableBrowsers.length === 0) {
      // Implement a waiting mechanism or expand pool
      await this.expandPool();
    }

    const browser = this.availableBrowsers.pop();
    
    // Validate browser connection
    if (!browser || !browser.isConnected()) {
      return this.createBrowser();
    }

    return browser;
  }

  async expandPool(additionalBrowsers = 2) {
    for (let i = 0; i < additionalBrowsers; i++) {
      const browser = await this.createBrowser();
      this.browsers.push(browser);
      this.availableBrowsers.push(browser);
    }
  }

  releaseBrowser(browser) {
    if (browser && browser.isConnected()) {
      this.availableBrowsers.push(browser);
    }
  }

  async cleanup() {
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (error) {
        console.error('[BrowserPool] Error closing browser:', error);
      }
    }
    this.browsers = [];
    this.availableBrowsers = [];
  }
}

// Performance and caching utils
const performanceCache = new Map();

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

// Performance logging decorator
function logPerformance(target, name, descriptor) {
  const originalMethod = descriptor.value;
  descriptor.value = async function(...args) {
    const startTime = performance.now();
    try {
      const result = await originalMethod.apply(this, args);
      console.log(`[Performance] ${name} took: ${getTimeDiff(startTime)}`);
      return result;
    } catch (error) {
      console.error(`[Performance] ${name} failed:`, error);
      throw error;
    }
  };
  return descriptor;
}

// Enhanced video processing
async function processApiResponse(data) {
  const startTime = performance.now();
  const results = [];
  
  // Cached response check
  const cacheKey = JSON.stringify(data);
  if (performanceCache.has(cacheKey)) {
    return performanceCache.get(cacheKey);
  }

  if (data.stream && data.stream.playlist) {
    const videoUrl = data.stream.playlist;
    const subtitles = (data.stream.captions || []).map(caption => ({
      label: caption.language,
      file: caption.url
    }));

    const processedResult = [{
      video_urls: [videoUrl],
      subtitles: subtitles,
      qualities: {
        '1080': `${videoUrl.split('playlist.m3u8')[0]}1080/index.m3u8`,
        '720': `${videoUrl.split('playlist.m3u8')[0]}720/index.m3u8`,
        '480': `${videoUrl.split('playlist.m3u8')[0]}480/index.m3u8`,
        '360': `${videoUrl.split('playlist.m3u8')[0]}360/index.m3u8`
      }
    }];

    performanceCache.set(cacheKey, processedResult);
    return processedResult;
  } else if (data.source) {
    const processedResults = [];
    if (Array.isArray(data.source)) {
      data.source.forEach(src => {
        if (src.file) processedResults.push({
          video_urls: [convertToDirectUrl(src.file)],
          subtitles: data.track || []
        });
      });
    } else if (data.source.file) {
      processedResults.push({
        video_urls: [convertToDirectUrl(data.source.file)],
        subtitles: data.track || []
      });
    }

    performanceCache.set(cacheKey, processedResults);
    return processedResults;
  }

  console.log(`[Time] Response processing took: ${getTimeDiff(startTime)}`);
  return results;
}

// Enhanced video URL extraction
async function getVideoUrl(page, embedUrl) {
  const startTime = performance.now();
  console.log('\n[Browser] Starting request tracking for:', embedUrl);
  
  let apiResponseData = null;
  let responseUrl = null;
  let apiResponseTime = null;

  try {
    // Advanced request interception
    await page.setRequestInterception(true);

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API response timeout'));
      }, 15000); // Adjusted timeout

      page.on('request', request => {
        const resourceType = request.resourceType();
        const url = request.url();

        // More aggressive resource blocking
        const shouldBlock = 
          ['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType) ||
          url.includes('.jpg') || 
          url.includes('.png') || 
          url.includes('.gif') || 
          url.includes('.css');

        if (shouldBlock) {
          request.abort();
          return;
        }
        
        request.continue();
      });

      page.on('response', async response => {
        const url = response.url();
        if (url.includes('/api/b/movie') || url.includes('/api/b/tv')) {
          try {
            const responseStartTime = performance.now();
            responseUrl = url;
            
            // Enhanced error handling for JSON parsing
            let data;
            try {
              data = await withProxy(async () => await response.json());
            } catch (parseError) {
              console.error('[Browser] JSON parsing error:', parseError);
              return; // Skip this response if parsing fails
            }

            apiResponseTime = getTimeDiff(responseStartTime);
            console.log(`[Browser] API response captured in: ${apiResponseTime}`);
            apiResponseData = data;
            clearTimeout(timeout);
            resolve(data);
          } catch (e) {
            console.log('[Browser] Failed to process API response:', e.message);
            reject(e);
          }
        }
      });
    });

    // Enhanced navigation with more robust timeout handling
    console.log('[Browser] Navigating to page');
    const navigationStartTime = performance.now();
    
    await Promise.race([
      withProxy(async () => 
        await page.goto(embedUrl, {
          waitUntil: 'networkidle0',
          timeout: 10000
        })
      ),
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
    throw error;
  }
}

// Initialize global managers
const videoStore = new VideoStoreManager();
const browserPoolManager = new BrowserPoolManager();

// Initialize browser pool on startup
(async () => {
  try {
    await browserPoolManager.initPool();
  } catch (error) {
    console.error('Failed to initialize browser pool:', error);
  }
})();

export const videoController = {
  async getVideoUrlFromEmbed(req, res) {
    const totalStartTime = performance.now();
    const { embedUrl } = req.query;
    if (!embedUrl) return res.status(400).json({ error: 'Embed URL required' });

    let browser = null;
    let page = null;
    try {
      const browserStartTime = performance.now();
      browser = await browserPoolManager.getBrowser();
      console.log(`[Time] Browser get/launch took: ${getTimeDiff(browserStartTime)}`);

      page = await browser.newPage();
      const data = await getVideoUrl(page, embedUrl);

      if (data.results?.length > 0) {
        const uniqueId = videoStore.set(uuidv4(), data.results[0].video_urls[0]);
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
        timing: { totalTime: getTimeDiff(totalStartTime) }
      });
    } finally {
      // Properly release resources
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('[Browser] Error closing page:', e.message);
        }
      }
      
      if (browser) {
        browserPoolManager.releaseBrowser(browser);
      }
    }
  },

  async getTVEpisode(req, res) {
    const totalStartTime = performance.now();
    const { id, season, episode } = req.params;
    let browser = null;
    let page = null;
    
    try {
      browser = await browserPoolManager.getBrowser();
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
      
      if (browser) {
        browserPoolManager.releaseBrowser(browser);
      }
    }
  },

  async getMovie(req, res) {
    const totalStartTime = performance.now();
    const { id } = req.params;
    let browser = null;
    let page = null;
    
    try {
      browser = await browserPoolManager.getBrowser();
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
      
      if (browser) {
        browserPoolManager.releaseBrowser(browser);
      }
    }
  },

  async cleanup() {
    videoStore.destroy();
    await browserPoolManager.cleanup();
  }
};