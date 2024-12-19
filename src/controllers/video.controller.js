import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { browserOptions, customNavigate } from '../utils/browser.js';
import { convertToDirectUrl } from '../utils/url-converter.js';

const videoStore = new Map();

async function getVideoUrl(page, embedUrl) {
  const videoUrls = new Set();
  
  try {
    await page.setRequestInterception(true);

    page.on('request', request => {
      const resourceType = request.resourceType();
      if (['image', 'stylesheet', 'font', 'download'].includes(resourceType)) {
        request.abort();
        return;
      }
      
      const url = request.url();
      if (resourceType === 'media' || url.includes('.m3u8') || url.includes('.mp4')) {
        videoUrls.add(url);
        if (videoUrls.size >= 2) {
          request.abort();
          return;
        }
      }
      request.continue();
    });

    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': new URL(embedUrl).origin
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    await customNavigate(page, embedUrl);
    
    const selectors = ['#player', '.play-button', 'video'];
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (videoUrls.size > 0) {
      return Array.from(videoUrls).map(url => convertToDirectUrl(url));
    }
    
    // Short wait for additional quality options
    await page.waitForResponse(
      response => {
        const url = response.url();
        const isVideo = url.includes('.m3u8') || url.includes('.mp4');
        if (isVideo) videoUrls.add(url);
        return isVideo && videoUrls.size >= 2;
      },
      { timeout: 5000 }
    ).catch(() => {});

    return Array.from(videoUrls).map(url => convertToDirectUrl(url));
    
  } catch (error) {
    console.error('Error fetching video URL:', error);
    return Array.from(videoUrls).map(url => convertToDirectUrl(url));
  }
}

// Rest of the controller code remains the same
export const videoController = {
  async getVideoUrlFromEmbed(req, res) {
    const { embedUrl } = req.query;
    if (!embedUrl) return res.status(400).json({ error: 'Embed URL required' });

    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
      const page = await browser.newPage();
      const videoUrls = await getVideoUrl(page, embedUrl);

      if (videoUrls.length > 0) {
        const uniqueId = uuidv4();
        videoStore.set(uniqueId, videoUrls[0]);
        res.json({ 
          videoUrls, 
          watchUrl: `${process.env.BASE_URL}/watch/${uniqueId}`
        });
      } else {
        res.status(404).json({ error: 'No video URL found' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch video URL', details: error.message });
    } finally {
      if (browser) await browser.close();
    }
  },

  async getTVEpisode(req, res) {
    const { id, season, episode } = req.params;
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
      const page = await browser.newPage();
      const videoUrls = await getVideoUrl(page, `https://vidlink.pro/tv/${id}/${season}/${episode}`);
      
      res.json({ 
        status: 'success',
        results: videoUrls.map(url => ({ video_urls: [url] }))
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message });
    } finally {
      if (browser) await browser.close();
    }
  },

  async getMovie(req, res) {
    const { id } = req.params;
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
      const page = await browser.newPage();
      const videoUrls = await getVideoUrl(page, `https://vidlink.pro/movie/${id}`);
      
      res.json({ 
        status: 'success',
        results: videoUrls.map(url => ({ video_urls: [url] }))
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message });
    } finally {
      if (browser) await browser.close();
    }
  }
};