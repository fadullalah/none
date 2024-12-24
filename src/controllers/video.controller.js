import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { convertToDirectUrl } from '../utils/url-converter.js';

puppeteer.use(StealthPlugin());

export const browserOptions = {
  headless: false,
  defaultViewport: null,
  slowMo: 100,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--hide-scrollbars',
    '--mute-audio',
    '--start-maximized',
    '--window-size=1920,1080'
  ],
  ignoreDefaultArgs: ['--enable-automation']
};

export async function customNavigate(page, url, maxRedirects = 3) {
  let currentUrl = url;
  let redirectCount = 0;

  console.log(`[Navigation] Starting navigation to: ${url}`);

  page.on('response', response => {
    console.log(`[Response] ${response.status()} ${response.url()}`);
  });

  while (redirectCount < maxRedirects) {
    console.log(`[Navigation] Attempt ${redirectCount + 1}/${maxRedirects}`);
    
    const response = await page.goto(currentUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const newUrl = response.url();
    console.log(`[Navigation] Current URL: ${newUrl}`);
    
    if (newUrl === currentUrl || newUrl === 'about:blank') break;

    currentUrl = newUrl;
    redirectCount++;
    
    await page.waitForTimeout(3000);
  }

  console.log(`[Navigation] Completed at: ${currentUrl}`);
  return currentUrl;
}

const videoStore = new Map();

async function getVideoUrl(page, embedUrl) {
  const videoUrls = new Set();
  
  try {
    await page.setRequestInterception(true);

    page.on('request', request => {
      const resourceType = request.resourceType();
      const url = request.url();
      
      if (resourceType === 'media' || url.includes('.m3u8') || url.includes('.mp4')) {
        videoUrls.add(url);
        if (videoUrls.size >= 2) {
          request.abort();
          return;
        }
      }
      
      if (['image', 'stylesheet', 'font', 'download'].includes(resourceType)) {
        request.abort();
        return;
      }

      console.log(`[Request] ${request.method()} ${request.url()}`);
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
    
    await page.waitForResponse(
      response => {
        const url = response.url();
        const isVideo = url.includes('.m3u8') || url.includes('.mp4');
        if (isVideo) videoUrls.add(url);
        return isVideo && videoUrls.size >= 2;
      },
      { timeout: 10000 }
    ).catch(() => {});

    return Array.from(videoUrls).map(url => convertToDirectUrl(url));
    
  } catch (error) {
    console.error('Error fetching video URL:', error);
    return Array.from(videoUrls).map(url => convertToDirectUrl(url));
  }
}

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