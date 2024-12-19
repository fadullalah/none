import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import { browserOptions, delay, customNavigate } from '../utils/browser.js';
import { convertToDirectUrl } from '../utils/url-converter.js';

const videoStore = new Map();

async function getVideoUrl(page, embedUrl) {
  const videoUrls = new Set();
  let foundVideoUrl = false;

  try {
    await page.setRequestInterception(true);

    page.on('request', request => {
      const url = request.url();
      const resourceType = request.resourceType();

      if (resourceType === 'download') {
        request.abort();
        return;
      }

      if (resourceType === 'media' || url.includes('.m3u8') || url.includes('.mp4')) {
        videoUrls.add(url);
        foundVideoUrl = true;
      }
      request.continue();
    });

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': new URL(embedUrl).origin,
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Upgrade-Insecure-Requests': '1'
    };

    await page.setExtraHTTPHeaders(headers);
    await setupPageBehavior(page);
    await customNavigate(page, embedUrl);
    await clickPlayerElements(page);

    const startTime = Date.now();
    while (!foundVideoUrl && Date.now() - startTime < 15000) {
      await delay(500);
    }

    return Array.from(videoUrls).map(url => convertToDirectUrl(url));
  } catch (error) {
    console.error('Error fetching video URL:', error);
    throw error;
  }
}

async function setupPageBehavior(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    
    window.addEventListener('beforeunload', (event) => {
      event.preventDefault();
      return event.returnValue = '';
    });
    
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'download') {
          mutation.target.removeAttribute('download');
        }
      });
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ['download']
    });
  });
}

async function clickPlayerElements(page) {
  const selectors = ['#player', '.play-button', '.video-container', 'video'];
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
    } catch (e) {
      // Continue if selector not found
    }
  }
}

export const videoController = {
  async getVideoUrlFromEmbed(req, res) {
    const { embedUrl } = req.query;

    if (!embedUrl) {
      return res.status(400).json({ error: 'Embed URL is required' });
    }

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
      res.status(500).json({
        error: 'Failed to fetch video URL',
        details: error.message
      });
    } finally {
      if (browser) await browser.close();
    }
  },

  async getTVEpisode(req, res) {
    const { id, season, episode } = req.params;
    const embedUrl = `https://vidlink.pro/tv/${id}/${season}/${episode}`;
    
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
      const page = await browser.newPage();
      const videoUrls = await getVideoUrl(page, embedUrl);
      
      res.json({ 
        status: 'success',
        results: videoUrls.map(url => ({ video_urls: [url] }))
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    } finally {
      if (browser) await browser.close();
    }
  },

  async getMovie(req, res) {
    const { id } = req.params;
    const embedUrl = `https://vidlink.pro/movie/${id}`;
    
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
      const page = await browser.newPage();
      const videoUrls = await getVideoUrl(page, embedUrl);
      
      res.json({ 
        status: 'success',
        results: videoUrls.map(url => ({ video_urls: [url] }))
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    } finally {
      if (browser) await browser.close();
    }
  }
};