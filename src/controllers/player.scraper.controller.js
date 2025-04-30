import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import NodeCache from 'node-cache';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';

// Register the stealth plugin
puppeteerExtra.use(StealthPlugin());

// Cache for storing extracted URLs (TTL: 3 hours)
const urlCache = new NodeCache({ stdTTL: 10800 });
// Cache for storing proxies (TTL: 1 hour)
const proxyCache = new NodeCache({ stdTTL: 3600 });

class PlayerScraperController {
  
  constructor() {
    this.proxyList = [];
    this.workingProxies = [];
    this.lastProxyUpdate = 0;
    this.proxyUpdateInterval = 60 * 60 * 1000; // 1 hour (increased from 30 minutes)
    this.proxyTestUrl = 'https://www.google.com';
    this.proxyTestTimeout = 3000; // 3 seconds (reduced from 5)
    this.isUpdatingProxies = false; // Flag to prevent multiple simultaneous updates
  }

  /**
   * Test if a proxy is working
   * @param {string} proxy - Proxy URL
   * @returns {Promise<boolean>} - Whether the proxy is working
   */
  async testProxy(proxy) {
    try {
      const httpsAgent = new HttpsProxyAgent(proxy);
      await axios.get(this.proxyTestUrl, {
        httpsAgent,
        timeout: this.proxyTestTimeout,
        proxy: false,
        validateStatus: () => true // Accept any status code
      });
      return true; // Proxy works
    } catch (error) {
      return false; // Proxy doesn't work
    }
  }

  /**
   * Fetch proxies from GitHub proxy lists
   */
  async updateProxyList() {
    const now = Date.now();
    
    // Skip if already updating or if we have working proxies and the cache isn't expired
    if (this.isUpdatingProxies || 
        (now - this.lastProxyUpdate < this.proxyUpdateInterval && this.workingProxies.length > 0)) {
      return;
    }
    
    this.isUpdatingProxies = true;
    
    try {
      // Use a faster, more reliable proxy source
      const sources = [
        'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'
      ];

      const proxies = [];
      for (const source of sources) {
        try {
          const response = await axios.get(source, { timeout: 3000 });
          const text = response.data;
          
          // Extract proxies using regex
          const matches = text.match(/\d+\.\d+\.\d+\.\d+:\d+/g);
          if (matches) {
            proxies.push(...matches.map(proxy => `http://${proxy}`));
          }
        } catch (error) {
          console.warn(`Failed to fetch proxies from ${source}: ${error.message}`);
        }
      }

      if (proxies.length > 0) {
        this.proxyList = proxies;
        console.log(`Found ${proxies.length} proxies, will test a small sample...`);
        
        // Test fewer proxies for faster startup
        const maxProxiesToTest = 10; // Reduced from 20
        const proxiesToTest = proxies
          .sort(() => 0.5 - Math.random()) // Shuffle array
          .slice(0, maxProxiesToTest);
        
        // Test proxies in parallel with shorter timeout
        const testPromises = proxiesToTest.map(proxy => {
          return Promise.race([
            this.testProxy(proxy).then(works => ({ proxy, works })),
            new Promise(resolve => setTimeout(() => resolve({ proxy, works: false }), 2000)) // 2 second timeout
          ]);
        });
        
        const results = await Promise.all(testPromises);
        const workingProxies = results
          .filter(result => result.works)
          .map(result => result.proxy);
        
        this.workingProxies = workingProxies;
        this.lastProxyUpdate = now;
        console.log(`Found ${workingProxies.length} working proxies out of ${proxiesToTest.length} tested`);
        
        // If we didn't find any working proxies, just use the first few from the list
        if (workingProxies.length === 0 && proxies.length > 0) {
          console.log("No working proxies found in test sample, using untested proxies as fallback");
          this.workingProxies = proxies.slice(0, 5); // Use first 5 as fallback (reduced from 10)
        }
      } else {
        console.warn('No proxies found from any source');
      }
    } catch (error) {
      console.error(`Error updating proxy list: ${error.message}`);
    } finally {
      this.isUpdatingProxies = false;
    }
  }

  /**
   * Get a random working proxy
   */
  getRandomProxy() {
    if (this.workingProxies.length === 0) {
      // Fall back to untested proxies if no working ones
      if (this.proxyList.length === 0) {
        return null;
      }
      const randomIndex = Math.floor(Math.random() * this.proxyList.length);
      return this.proxyList[randomIndex];
    }
    
    const randomIndex = Math.floor(Math.random() * this.workingProxies.length);
    return this.workingProxies[randomIndex];
  }

  /**
   * Get browser-like headers
   */
  getBrowserHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive'
    };
  }
  
  /**
   * Extract video URL from any player
   * @param {Object} req - Request object with player URL in query params
   * @param {Object} res - Response object
   */
  async extractVideoUrl(req, res) {
    try {
      const { url } = req.query;
      
      if (!url) {
        return res.status(400).json({ 
          success: false, 
          message: 'Player URL is required' 
        });
      }
      
      // Check cache first
      const cachedUrl = urlCache.get(url);
      if (cachedUrl) {
        return res.json({
          success: true,
          source: 'cache',
          videoUrl: cachedUrl
        });
      }
      
      // Start proxy update in background but don't wait for it
      this.updateProxyList().catch(err => console.log(`Background proxy update error: ${err.message}`));
      
      // Try to identify the player type
      const playerType = this.identifyPlayerType(url);
      
      // Extract using appropriate method
      let videoUrl;
      let extractionDetails = {
        attemptedMethods: [],
        playerType: playerType || 'unknown',
        errors: []
      };
      
      // Try direct method first (fastest)
      extractionDetails.attemptedMethods.push('direct');
      try {
        videoUrl = await this.extractDirectMethod(url);
      } catch (error) {
        extractionDetails.errors.push({
          method: 'direct',
          error: error.message
        });
      }
      
      // If direct method fails, try puppeteer (more reliable)
      if (!videoUrl) {
        extractionDetails.attemptedMethods.push('puppeteer');
        try {
          videoUrl = await this.extractWithPuppeteer(url);
        } catch (error) {
          extractionDetails.errors.push({
            method: 'puppeteer',
            error: error.message
          });
        }
      }
      
      // Only try proxy methods if the above methods fail
      if (!videoUrl && this.workingProxies.length > 0) {
        // Try with proxy
        extractionDetails.attemptedMethods.push('direct_with_proxy');
        try {
          videoUrl = await this.extractDirectMethodWithProxy(url);
        } catch (error) {
          extractionDetails.errors.push({
            method: 'direct_with_proxy',
            error: error.message
          });
        }
        
        // Last resort: try puppeteer with proxy
        if (!videoUrl) {
          extractionDetails.attemptedMethods.push('puppeteer_with_proxy');
          try {
            videoUrl = await this.extractWithPuppeteerAndProxy(url);
          } catch (error) {
            extractionDetails.errors.push({
              method: 'puppeteer_with_proxy',
              error: error.message
            });
          }
        }
      }
      
      // Try specialized extractor if available and other methods failed
      if (!videoUrl && playerType && this.extractors[playerType]) {
        extractionDetails.attemptedMethods.push(`specialized_${playerType}`);
        try {
          videoUrl = await this.extractors[playerType](url);
        } catch (error) {
          extractionDetails.errors.push({
            method: `specialized_${playerType}`,
            error: error.message
          });
        }
      }
      
      if (!videoUrl) {
        return res.status(404).json({
          success: false,
          message: 'Could not extract video URL from player',
          details: extractionDetails
        });
      }
      
      // Cache the result
      urlCache.set(url, videoUrl);
      
      return res.json({
        success: true,
        source: 'extraction',
        playerType: playerType || 'generic',
        extractionMethod: extractionDetails.attemptedMethods[extractionDetails.attemptedMethods.length - 1],
        videoUrl
      });
    } catch (error) {
      console.error('Error extracting video URL:', error);
      return res.status(500).json({
        success: false,
        message: 'Error extracting video URL',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  
  /**
   * Identify player type from URL
   */
  identifyPlayerType(url) {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Check for known Cloudflare-protected sites
    const cloudflareProtectedDomains = [
      'streamtape.com',
      'vidoza.net',
      'vidhd.fun',
      'vidcloud.stream'
      // Add more known Cloudflare-protected domains as needed
    ];
    
    if (cloudflareProtectedDomains.some(domain => hostname.includes(domain))) {
      return 'cloudflareProtected';
    }
    
    if (hostname.includes('youtube') || hostname.includes('youtu.be')) {
      return 'youtube';
    } else if (hostname.includes('vimeo')) {
      return 'vimeo';
    } else if (hostname.includes('dailymotion')) {
      return 'dailymotion';
    } else if (hostname.includes('jwplayer')) {
      return 'jwplayer';
    }
    // Add more player identifications as needed
    
    return null; // Unknown player
  }
  
  /**
   * Extract video URL using direct HTTP request (faster method)
   */
  async extractDirectMethod(url) {
    try {
      const response = await axios.get(url, {
        headers: this.getBrowserHeaders(),
        timeout: 10000
      });
      const html = response.data;
      
      // Parse HTML
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      // Try various common selectors and patterns
      
      // 1. Look for video tags
      const videoTags = document.querySelectorAll('video source');
      for (const source of videoTags) {
        const src = source.getAttribute('src');
        if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
          return this.resolveUrl(src, url);
        }
      }
      
      // 2. Look for m3u8 links in the HTML
      const m3u8Match = html.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
      if (m3u8Match && m3u8Match[1]) {
        return m3u8Match[1];
      }
      
      // 3. Look for mp4 links
      const mp4Match = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
      if (mp4Match && mp4Match[1]) {
        return mp4Match[1];
      }
      
      return null;
    } catch (error) {
      // Simplified error logging
      console.log(`Direct extraction failed: ${error.message}`);
      throw new Error(`Direct method failed: ${error.message}`);
    }
  }
  
  /**
   * Extract video URL using direct HTTP request with proxy (now using ScraperAPI)
   */
  async extractDirectMethodWithProxy(url) {
    try {
      // ScraperAPI proxy details
      const scraperApiHost = 'proxy-server.scraperapi.com';
      const scraperApiPort = 8001;
      const scraperApiUser = 'scraperapi';
      const scraperApiKey = '169e05c208dcbe5e453edd9c5957cc40';

      // Format: http://username:password@host:port
      const proxyUrl = `http://${scraperApiUser}:${scraperApiKey}@${scraperApiHost}:${scraperApiPort}`;
      const agent = new https.Agent({ rejectUnauthorized: false });
      const httpsAgent = new HttpsProxyAgent(proxyUrl);

      const response = await axios.get(url, {
        headers: this.getBrowserHeaders(),
        timeout: 15000,
        httpsAgent,
        httpAgent: agent,
        proxy: false // Let the HttpsProxyAgent handle the proxy
      });

      const html = response.data;

      // Parse HTML
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // Try various common selectors and patterns

      // 1. Look for video tags
      const videoTags = document.querySelectorAll('video source');
      for (const source of videoTags) {
        const src = source.getAttribute('src');
        if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
          return this.resolveUrl(src, url);
        }
      }

      // 2. Look for m3u8 links in the HTML
      const m3u8Match = html.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
      if (m3u8Match && m3u8Match[1]) {
        return m3u8Match[1];
      }

      // 3. Look for mp4 links
      const mp4Match = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
      if (mp4Match && mp4Match[1]) {
        return mp4Match[1];
      }

      return null;
    } catch (error) {
      // Simplified error logging - just log the message, not the full error
      console.log(`Direct extraction with proxy failed: ${error.message}`);
      throw new Error(`Direct method with proxy failed: ${error.message}`);
    }
  }
  
  /**
   * Extract video URL using Puppeteer (more reliable but slower)
   */
  async extractWithPuppeteer(url) {
    let browser = null;
    try {
      browser = await puppeteerExtra.launch({
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--single-process',
          '--disable-dev-shm-usage'
        ]
      });
      
      const page = await browser.newPage();
      
      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // Add additional headers to appear more like a real browser
      await page.setExtraHTTPHeaders(this.getBrowserHeaders());
      
      // Intercept network requests to find video streams
      let videoUrl = null;
      await page.setRequestInterception(true);
      
      page.on('request', request => {
        const requestUrl = request.url();
        if (requestUrl.includes('.m3u8') || requestUrl.includes('.mp4')) {
          videoUrl = requestUrl;
        }
        request.continue();
      });
      
      // Navigate to the player URL with a longer timeout for Cloudflare challenges
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Check if we need to solve a Cloudflare challenge
      const cloudflareDetected = await page.evaluate(() => {
        return document.title.includes('Cloudflare') || 
               document.body.textContent.includes('DDoS protection by Cloudflare') ||
               document.querySelector('iframe[src*="cloudflare"]') !== null;
      });
      
      if (cloudflareDetected) {
        console.log('Cloudflare challenge detected, waiting for it to be solved...');
        // Wait longer to pass the Cloudflare challenge
        await page.waitForTimeout(10000);
        // Wait until the page content changes (challenge solved)
        await page.waitForFunction(
          'document.title !== "Just a moment..." && !document.title.includes("Cloudflare")',
          { timeout: 30000 }
        );
      }
      
      // If no video URL was found in network requests, try to find it in the page
      if (!videoUrl) {
        videoUrl = await page.evaluate(() => {
          // Try to find video elements
          const videoElements = document.querySelectorAll('video');
          for (const video of videoElements) {
            if (video.src) return video.src;
            
            // Check sources
            const sources = video.querySelectorAll('source');
            for (const source of sources) {
              if (source.src) return source.src;
            }
          }
          
          // Look for JSON configs that might contain video URLs
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent;
            if (!content) continue;
            
            // Look for common patterns in player configs
            const m3u8Match = content.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
            if (m3u8Match && m3u8Match[1]) return m3u8Match[1];
            
            const mp4Match = content.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
            if (mp4Match && mp4Match[1]) return mp4Match[1];
          }
          
          return null;
        });
      }
      
      await browser.close();
      return videoUrl;
    } catch (error) {
      console.log(`Puppeteer extraction failed: ${error.message}`);
      if (browser) await browser.close();
      throw new Error(`Puppeteer method failed: ${error.message}`);
    }
  }
  
  /**
   * Extract video URL using Puppeteer with proxy (now using ScraperAPI)
   */
  async extractWithPuppeteerAndProxy(url) {
    let browser = null;
    try {
      // ScraperAPI proxy details
      const scraperApiHost = 'proxy-server.scraperapi.com';
      const scraperApiPort = 8001;
      const scraperApiUser = 'scraperapi';
      const scraperApiKey = '169e05c208dcbe5e453edd9c5957cc40';

      // Format: http://username:password@host:port
      const proxyAuth = `${scraperApiUser}:${scraperApiKey}`;
      const proxyServer = `http://${proxyAuth}@${scraperApiHost}:${scraperApiPort}`;

      browser = await puppeteerExtra.launch({
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--single-process',
          '--disable-dev-shm-usage',
          `--proxy-server=${scraperApiHost}:${scraperApiPort}`
        ]
      });

      const page = await browser.newPage();

      // Set proxy authentication for ScraperAPI
      await page.authenticate({
        username: scraperApiUser,
        password: scraperApiKey
      });

      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // Add additional headers to appear more like a real browser
      await page.setExtraHTTPHeaders(this.getBrowserHeaders());
      
      // Intercept network requests to find video streams
      let videoUrl = null;
      await page.setRequestInterception(true);
      
      page.on('request', request => {
        const requestUrl = request.url();
        if (requestUrl.includes('.m3u8') || requestUrl.includes('.mp4')) {
          videoUrl = requestUrl;
        }
        request.continue();
      });
      
      // Navigate to the player URL with a longer timeout for Cloudflare challenges
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Check if we need to solve a Cloudflare challenge
      const cloudflareDetected = await page.evaluate(() => {
        return document.title.includes('Cloudflare') || 
               document.body.textContent.includes('DDoS protection by Cloudflare') ||
               document.querySelector('iframe[src*="cloudflare"]') !== null;
      });
      
      if (cloudflareDetected) {
        console.log('Cloudflare challenge detected, waiting for it to be solved...');
        // Wait longer to pass the Cloudflare challenge
        await page.waitForTimeout(10000);
        // Wait until the page content changes (challenge solved)
        await page.waitForFunction(
          'document.title !== "Just a moment..." && !document.title.includes("Cloudflare")',
          { timeout: 30000 }
        );
      }
      
      // If no video URL was found in network requests, try to find it in the page
      if (!videoUrl) {
        videoUrl = await page.evaluate(() => {
          // Try to find video elements
          const videoElements = document.querySelectorAll('video');
          for (const video of videoElements) {
            if (video.src) return video.src;
            
            // Check sources
            const sources = video.querySelectorAll('source');
            for (const source of sources) {
              if (source.src) return source.src;
            }
          }
          
          // Look for JSON configs that might contain video URLs
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent;
            if (!content) continue;
            
            // Look for common patterns in player configs
            const m3u8Match = content.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
            if (m3u8Match && m3u8Match[1]) return m3u8Match[1];
            
            const mp4Match = content.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
            if (mp4Match && mp4Match[1]) return mp4Match[1];
          }
          
          return null;
        });
      }
      
      await browser.close();
      return videoUrl;
    } catch (error) {
      console.log(`Puppeteer with proxy failed: ${error.message}`);
      if (browser) await browser.close();
      throw new Error(`Puppeteer with proxy method failed: ${error.message}`);
    }
  }
  
  /**
   * Resolve relative URLs to absolute
   */
  resolveUrl(src, baseUrl) {
    if (src.startsWith('http')) return src;
    
    const base = new URL(baseUrl);
    if (src.startsWith('//')) {
      return `${base.protocol}${src}`;
    } else if (src.startsWith('/')) {
      return `${base.origin}${src}`;
    } else {
      return new URL(src, baseUrl).href;
    }
  }
  
  /**
   * Specialized extractors for common players
   */
  extractors = {
    youtube: async (url) => {
      try {
        // YouTube extraction logic
        // Note: YouTube requires special handling due to encryption
        // Consider using ytdl-core or similar library
        throw new Error('YouTube extraction not implemented');
      } catch (error) {
        throw new Error(`YouTube extractor failed: ${error.message}`);
      }
    },
    
    vimeo: async (url) => {
      try {
        const id = url.match(/vimeo.com\/(?:video\/)?(\d+)/)[1];
        const response = await axios.get(`https://player.vimeo.com/video/${id}/config`);
        const data = response.data;
        return data.request.files.progressive[0].url;
      } catch (error) {
        throw new Error(`Vimeo extractor failed: ${error.message}`);
      }
    },
    
    jwplayer: async (url) => {
      try {
        // JW Player extraction logic
        throw new Error('JW Player extraction not implemented');
      } catch (error) {
        throw new Error(`JW Player extractor failed: ${error.message}`);
      }
    },
    
    cloudflareProtected: async (url) => {
      try {
        // For sites known to be protected by Cloudflare, use the Puppeteer method directly
        return this.extractWithPuppeteer(url);
      } catch (error) {
        throw new Error(`Cloudflare-protected site extractor failed: ${error.message}`);
      }
    }
  }
}

export const playerScraperController = new PlayerScraperController(); 