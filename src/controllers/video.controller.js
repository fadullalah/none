import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { browserOptions, createStealthPage } from '../utils/browser.js';

const videoStore = new Map();
let browserInstance = null;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

async function getBrowser() {
  try {
    if (!browserInstance || !browserInstance.isConnected()) {
      console.log('[Browser] Creating new browser instance');
      browserInstance = await puppeteer.launch({
        ...browserOptions,
        args: [
          ...browserOptions.args,
          '--no-zygote',
          '--disable-dev-shm-usage'
        ]
      });
    }
    return browserInstance;
  } catch (error) {
    console.error('[Browser] Launch error:', error);
    browserInstance = null;
    throw error;
  }
}

async function getVideoData(page, url) {
  const startTime = performance.now();
  console.log('\n[Browser] Starting video extraction for:', url);
  
  let videoUrls = new Set();
  let subtitles = [];
  let foundVideoUrl = false;
  let navigationPromise;

  try {
    // Set up request interception
    await page.setRequestInterception(true);

    // Create a promise that resolves when we find a video URL
    const videoFoundPromise = new Promise(resolve => {
      if (foundVideoUrl) resolve();
      const interval = setInterval(() => {
        if (foundVideoUrl || videoUrls.size > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
      // Clear interval after 20 seconds
      setTimeout(() => clearInterval(interval), 20000);
    });

    // Monitor all requests
    page.on('request', request => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();

      // Block unnecessary resources
      if (['image', 'stylesheet', 'font'].includes(resourceType)) {
        request.abort();
        return;
      }

      // Capture video URLs
      if (resourceType === 'media' || 
          reqUrl.includes('.m3u8') || 
          reqUrl.includes('.mp4') || 
          reqUrl.includes('/playlist/') ||
          reqUrl.includes('/manifest/')) {
        videoUrls.add(reqUrl);
        foundVideoUrl = true;
        console.log('[Browser] Found video URL:', reqUrl);
      }

      request.continue();
    });

    // Set up anti-detection measures
    await page.evaluateOnNewDocument(() => {
      // Override navigator properties
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      
      // Disable right-click
      document.addEventListener('contextmenu', (e) => e.preventDefault());
      
      // Block download attribute
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'download') {
            mutation.target.removeAttribute('download');
          }
        });
      });
      
      observer.observe(document, {
        attributes: true,
        subtree: true,
        attributeFilter: ['download']
      });
    });

    // Navigate to the page with a race condition
    console.log('[Browser] Navigating to page');
    try {
      navigationPromise = Promise.race([
        page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        }),
        videoFoundPromise
      ]);
      await navigationPromise;
    } catch (error) {
      console.log('[Browser] Navigation timeout or error:', error.message);
      // Continue if we have found video URLs despite the timeout
      if (videoUrls.size > 0) {
        console.log('[Browser] Continuing with found video URLs despite navigation error');
      } else {
        throw error;
      }
    }

    // Try to find and click on player elements
    const selectors = ['#player', '.play-button', '.video-container', 'video', '.jw-video', '.plyr'];
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
      } catch (e) {
        // Continue if selector not found
      }
    }

    // Also try to extract from HTML/scripts as backup
    const scriptVideoData = await page.evaluate(() => {
      const scriptTags = document.getElementsByTagName('script');
      let m3u8Link = null;
      let subs = [];

      for (const script of scriptTags) {
        const content = script.textContent;
        
        // Look for various patterns
        const patterns = [
          /titleM3u8Link\s*=\s*["']([^"']+)["']/,
          /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
          /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/,
          /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/
        ];

        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            m3u8Link = match[1];
            break;
          }
        }

        // Look for subtitles
        const subsMatch = content.match(/subtitles\s*=\s*(\[[^\]]+\])/);
        if (subsMatch) {
          try {
            subs = eval(subsMatch[1]);
          } catch (e) {}
        }
      }

      return { m3u8Link, subs };
    });

    if (scriptVideoData.m3u8Link) {
      videoUrls.add(scriptVideoData.m3u8Link);
      subtitles = scriptVideoData.subs;
    }

    // Wait a bit for dynamic loading if we haven't found URLs yet
    if (videoUrls.size === 0) {
      const startWaitTime = Date.now();
      while (!foundVideoUrl && Date.now() - startWaitTime < 15000) {
        await delay(500);
      }
    }

    const videoUrlsArray = Array.from(videoUrls);
    
    if (videoUrlsArray.length === 0) {
      throw new Error('No video URL found');
    }

    // Process the first valid m3u8 URL
    const mainVideoUrl = videoUrlsArray.find(url => url.includes('.m3u8')) || videoUrlsArray[0];
    
    // Generate quality variants
    const qualities = {};
    if (mainVideoUrl.includes('.m3u8')) {
      const basePath = mainVideoUrl.split('index.m3u8')[0];
      qualities['1080'] = `${basePath}1080/index.m3u8`;
      qualities['720'] = `${basePath}720/index.m3u8`;
      qualities['480'] = `${basePath}480/index.m3u8`;
      qualities['360'] = `${basePath}360/index.m3u8`;
    }

    const results = [{
      video_urls: videoUrlsArray,
      subtitles: subtitles,
      qualities: qualities
    }];

    console.log(`[Time] Total processing time: ${getTimeDiff(startTime)}`);
    return {
      results,
      timing: {
        total: getTimeDiff(startTime)
      }
    };

  } catch (error) {
    console.error('[Browser] Error:', error.message);
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

      page = await createStealthPage(browser);
      const data = await getVideoData(page, embedUrl);

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
      page = await createStealthPage(browser);
      const data = await getVideoData(page, `https://vidsrc.cc/v3/embed/tv/${id}/${season}/${episode}`);
      
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
      page = await createStealthPage(browser);
      const data = await getVideoData(page, `https://vidsrc.cc/v2/embed/movie/${id}`);
      
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