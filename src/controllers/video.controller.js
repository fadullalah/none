import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { convertToDirectUrl } from '../utils/url-converter.js';
import { getProxyEnabledBrowserOptions } from '../utils/proxy-integration.js';
import { withProxy } from '../utils/proxy-integration.js';

const videoStore = new Map();
let browserInstance = null;

function getTimeDiff(startTime) {
  return `${(performance.now() - startTime).toFixed(2)}ms`;
}

// Browser management with error handling
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

async function getVideoUrl(page, embedUrl) {
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
            // Wrap the response.json() call with withProxy
            const data = await withProxy(async () => await response.json());
            apiResponseTime = getTimeDiff(responseStartTime);
            console.log(`[Browser] API response captured in: ${apiResponseTime}`);
            apiResponseData = data;
            clearTimeout(timeout);
            resolve(data);
          } catch (e) {
            console.log('[Browser] Failed to parse API response:', e.message);
          }
        }
      });    });

    // Navigate to page with shorter timeout
    console.log('[Browser] Navigating to page');
    const navigationStartTime = performance.now();
    
    await Promise.race([
      withProxy(async () => 
      await withProxy(async () => 
          await page.goto(embedUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 10000
          })
      )
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