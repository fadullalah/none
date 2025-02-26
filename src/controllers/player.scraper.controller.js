import puppeteer from 'puppeteer';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import NodeCache from 'node-cache';

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
      
      if (playerType && this.extractors[playerType]) {
        // Use specialized extractor if available
        videoUrl = await this.extractors[playerType](url);
      } else {
        // Try direct method first (faster)
        videoUrl = await this.extractDirectMethod(url);
        
        // If direct method fails, try puppeteer (more reliable)
        if (!videoUrl) {
          videoUrl = await this.extractWithPuppeteer(url);
        }
      }
      
      if (!videoUrl) {
        return res.status(404).json({
          success: false,
          message: 'Could not extract video URL from player'
        });
      }
      
      // Cache the result
      urlCache.set(url, videoUrl);
      
      return res.json({
        success: true,
        source: 'extraction',
        videoUrl
      });
    } catch (error) {
      console.error('Error extracting video URL:', error);
      return res.status(500).json({
        success: false,
        message: 'Error extracting video URL',
        error: error.message
      });
    }
  }
  
  /**
   * Identify player type from URL
   */
  identifyPlayerType(url) {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
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
      return null;
    }
  }
  
  /**
   * Extract video URL using Puppeteer (more reliable but slower)
   */
  async extractWithPuppeteer(url) {
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      
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
      
      // Navigate to the player URL
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
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
          
          return null;
        });
      }
      
      await browser.close();
      return videoUrl;
    } catch (error) {
      console.error('Puppeteer extraction error:', error);
      if (browser) await browser.close();
      return null;
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
      // YouTube extraction logic
      // Note: YouTube requires special handling due to encryption
      // Consider using ytdl-core or similar library
      return null;
    },
    
    vimeo: async (url) => {
      try {
        const id = url.match(/vimeo.com\/(?:video\/)?(\d+)/)[1];
        const response = await axios.get(`https://player.vimeo.com/video/${id}/config`);
        const data = response.data;
        return data.request.files.progressive[0].url;
      } catch {
        return null;
      }
    },
    
    jwplayer: async (url) => {
      // JW Player extraction logic
      return null;
    }
    
    // Add more specialized extractors as needed
  }
}

export const playerScraperController = new PlayerScraperController(); 