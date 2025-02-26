import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import NodeCache from 'node-cache';

// Register the stealth plugin
puppeteerExtra.use(StealthPlugin());

// Cache for storing extracted URLs (TTL: 3 hours)
const urlCache = new NodeCache({ stdTTL: 10800 });

class PlayerScraperController {
  
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
      
      // Try to identify the player type
      const playerType = this.identifyPlayerType(url);
      
      // Extract using appropriate method
      let videoUrl;
      let extractionDetails = {
        attemptedMethods: [],
        playerType: playerType || 'unknown',
        errors: []
      };
      
      if (playerType && this.extractors[playerType]) {
        // Use specialized extractor if available
        extractionDetails.attemptedMethods.push(`specialized_${playerType}`);
        try {
          videoUrl = await this.extractors[playerType](url);
        } catch (error) {
          extractionDetails.errors.push({
            method: `specialized_${playerType}`,
            error: error.message
          });
        }
      } else {
        // Try direct method first (faster)
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
      const response = await axios.get(url);
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
      console.error('Direct extraction error:', error);
      // Re-throw with more context
      throw new Error(`Direct method failed: ${error.message}`);
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
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
      
      const page = await browser.newPage();
      
      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // Add additional headers to appear more like a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      });
      
      // Intercept network requests to find video streams
      let videoUrl = null;
      page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mp4')) {
          videoUrl = url;
        }
        request.continue();
      });
      
      // Enable request interception
      await page.setRequestInterception(true);
      
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
      console.error('Puppeteer extraction error:', error);
      if (browser) await browser.close();
      // Re-throw with more context
      throw new Error(`Puppeteer method failed: ${error.message}`);
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