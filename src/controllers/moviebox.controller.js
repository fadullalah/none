import axios from 'axios';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import NodeCache from 'node-cache';
import { bunnyStreamController } from './bunny.controller.js';

// Register stealth plugin to avoid detection
puppeteerExtra.use(StealthPlugin());

// Cache with 3 hour TTL
const movieboxCache = new NodeCache({ stdTTL: 10800 });

// Browser pool management
let browserInstance = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 300000; // 5 minutes

// Helper function to replace waitForTimeout
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class MovieBoxController {
  constructor() {
    this.baseUrl = 'https://h5.aoneroom.com';
    this.searchUrl = `${this.baseUrl}/web/searchResult`;
    this.tmdbApiKey = process.env.API_TOKEN;
    this.tmdbApiBaseUrl = 'https://api.themoviedb.org/3';
    
    // Enhanced headers to appear as a regular browser
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
      'Origin': 'https://www.google.com',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'DNT': Math.random() > 0.5 ? '1' : null, // Randomly set Do Not Track
    };
    
    // More realistic user agents with browser versions that match the current date
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPad; CPU OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ];
    
    // Common screen resolutions for better variance
    this.screenResolutions = [
      { width: 1366, height: 768 },  // Most common laptop
      { width: 1920, height: 1080 }, // Full HD
      { width: 1536, height: 864 },  // Common laptop
      { width: 1440, height: 900 },  // MacBook
      { width: 1680, height: 1050 }, // Larger laptop
      { width: 1280, height: 720 },  // HD
    ];
    
    // Set up random IP rotation interval (more realistic than UA rotation)
    setInterval(this.rotateUserIdentity.bind(this), 
      Math.floor(Math.random() * 600000) + 300000); // 5-15 minutes
    
    // Cookie storage to simulate real browser persistence
    this.cookieJar = {};
    
    // Set up browser cleanup interval
    setInterval(this.cleanupBrowser.bind(this), 60000); // Check every minute
  }
  
  /**
   * Generate a random delay to simulate human timing
   * @param {number} min - Minimum delay in ms
   * @param {number} max - Maximum delay in ms
   * @returns {Promise<void>}
   */
  async humanDelay(min = 500, max = 3000) {
    const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;
    await delay(randomDelay);
  }
  
  /**
   * Rotate user identity parameters (more comprehensive than just user-agent)
   */
  rotateUserIdentity() {
    // Select a random user agent
    const randomAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    this.headers['User-Agent'] = randomAgent;
    
    // Randomize accept-language with proper format and weights
    const languages = ['en-US', 'en', 'fr', 'de', 'es', 'it'];
    const primaryLang = languages[Math.floor(Math.random() * 2)]; // Favor English
    const secondaryLang = languages[Math.floor(Math.random() * languages.length)];
    this.headers['Accept-Language'] = `${primaryLang},${secondaryLang};q=${(Math.random() * 0.4 + 0.5).toFixed(1)}`;
    
    // Random DNT (Do Not Track) setting
    if (Math.random() > 0.7) {
      this.headers['DNT'] = '1';
    } else {
      delete this.headers['DNT'];
    }
    
    // Update browser-specific headers based on the user agent
    if (randomAgent.includes('Firefox')) {
      this.headers['Sec-Ch-Ua'] = null;
      this.headers['Sec-Ch-Ua-Mobile'] = null;
      this.headers['Sec-Ch-Ua-Platform'] = null;
    } else if (randomAgent.includes('Chrome')) {
      const chromeVersion = randomAgent.match(/Chrome\/(\d+)/)[1];
      this.headers['Sec-Ch-Ua'] = `"Google Chrome";v="${chromeVersion}", "Not:A-Brand";v="8", "Chromium";v="${chromeVersion}"`;
      this.headers['Sec-Ch-Ua-Platform'] = randomAgent.includes('Windows') ? '"Windows"' : 
                                         randomAgent.includes('Mac') ? '"macOS"' : 
                                         randomAgent.includes('Linux') ? '"Linux"' : 
                                         randomAgent.includes('iPhone') || randomAgent.includes('iPad') ? '"iOS"' : '"Unknown"';
    }
    
    // Mobile detection
    this.headers['Sec-Ch-Ua-Mobile'] = randomAgent.includes('Mobile') || 
                                     randomAgent.includes('iPhone') || 
                                     randomAgent.includes('iPad') ? '?1' : '?0';
  }

  /**
   * Get or create a browser instance with more realistic settings
   * @returns {Promise<Browser>} Puppeteer browser instance
   */
  async getBrowser() {
    try {
      if (!browserInstance || !browserInstance.process() || browserInstance.process().killed) {
        if (browserInstance) {
          try {
            await browserInstance.close().catch(() => {});
          } catch (err) {} 
          browserInstance = null;
        }
        
        // Choose a random viewport size for better fingerprint variance
        const viewport = this.screenResolutions[
          Math.floor(Math.random() * this.screenResolutions.length)
        ];
        
        browserInstance = await puppeteerExtra.launch({
          headless: "new",  // Use new headless mode
          defaultViewport: viewport,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-dev-shm-usage',
            '--js-flags=--expose-gc',
            '--disable-gpu',
            `--window-size=${viewport.width},${viewport.height}`,
            '--disable-notifications',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',  // Reduce fingerprinting
            '--hide-scrollbars',                // Common in normal browsers
            '--disable-background-networking',  // Prevent suspicious background activity
            '--no-default-browser-check',       // Look more like regular browser
            '--disable-extensions',             // Fewer fingerprinting signals
            '--disable-domain-reliability',     // Avoid extra network activity
            `--user-agent=${this.headers['User-Agent']}` // Match UA from headers
          ],
          ignoreDefaultArgs: [
            '--enable-automation',
            '--disable-extensions',
          ],
          // Add preferences that real users would typically have
          userDataDir: null // Using a null directory prevents profile saving
        });
      }
      
      browserLastUsed = Date.now();
      return browserInstance;
    } catch (error) {
      console.error(`Error creating browser instance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up browser if idle for too long
   */
  async cleanupBrowser() {
    if (browserInstance && Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
      try {
        await browserInstance.close();
      } catch (err) {
        console.error('Error closing browser:', err.message);
      } finally {
        browserInstance = null;
      }
    }
  }

  /**
   * Get movie details from TMDB API
   * @param {string} tmdbId - TMDB ID of the movie
   * @returns {Promise<Object>} - Movie details
   */
  async getMovieDetailsFromTMDB(tmdbId) {
    try {
      const url = `${this.tmdbApiBaseUrl}/movie/${tmdbId}?api_key=${this.tmdbApiKey}&language=en-US`;
      const response = await axios.get(url, { headers: this.headers });
      return response.data;
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error fetching movie details from TMDB: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw new Error(`TMDB API error: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
    }
  }

  /**
   * Get TV show details from TMDB API
   * @param {string} tmdbId - TMDB ID of the TV show
   * @returns {Promise<Object>} - TV show details
   */
  async getTVDetailsFromTMDB(tmdbId) {
    try {
      const url = `${this.tmdbApiBaseUrl}/tv/${tmdbId}?api_key=${this.tmdbApiKey}&language=en-US`;
      const response = await axios.get(url, { headers: this.headers });
      return response.data;
    }
    catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error fetching TV details from TMDB: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw new Error(`TMDB API error: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
    }
  }

  /**
   * Search for movies/TV shows on MovieBox
   * @param {string} query - Search query
   * @returns {Promise<Array>} - Search results
   */
  async search(query) {
    const cacheKey = `moviebox_search_${query}`;
    
    const cachedResults = movieboxCache.get(cacheKey);
    if (cachedResults) {
      return cachedResults;
    }
    
    const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(query)}`;
    
    let browser, page;
    try {
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Optimize page for speed
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // Block unnecessary resources
        const resourceType = request.resourceType();
        if (['image', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Apply enhanced headers for better anonymity
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(30000);
      
      // Navigate to search page with faster load strategy
      const response = await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      if (!response.ok()) {
        const status = response.status();
        throw new Error(`Search page returned status ${status} (${response.statusText()})`);
      }
      
      // Wait for content to load
      await page.waitForSelector('.pc-card', { timeout: 10000 }).catch(() => {});
      
      // Extract search results
      const searchResults = await page.evaluate(() => {
        const shows = [];
        const cards = document.querySelectorAll('.pc-card');
        
        if (cards.length === 0) {
          return shows;
        }
        
        cards.forEach(card => {
          const titleElement = card.querySelector('.pc-card-title');
          const buttonElement = card.querySelector('.pc-card-btn');
          const ratingElement = card.querySelector('.pc-rate');
          const imageElement = card.querySelector('img.banner');
          
          if (titleElement && buttonElement) {
            const title = titleElement.textContent.trim();
            // Store card index for clicking later
            const cardIndex = Array.from(document.querySelectorAll('.pc-card')).indexOf(card);
            const rating = ratingElement ? parseFloat(ratingElement.textContent.trim()) : 0;
            const image = imageElement ? imageElement.src : '';
            
            shows.push({
              title,
              cardIndex, // We'll use this to click on the correct card
              rating,
              image
            });
          }
        });
        
        return shows;
      });
      
      // Cache results
      movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
      
      await page.close(); // Close page but keep browser
      return searchResults;
    } catch (error) {
      console.error(`Error searching MovieBox: ${error.message}`);
      
      if (page) {
        await page.close().catch(() => {});
      }
      
      throw error;
    }
  }
  
  /**
   * Perform enhanced search with multiple strategies
   * @param {Object} details - Movie or TV show details from TMDB
   * @returns {Promise<Array>} - Search results
   */
  async enhancedSearch(details) {
    const title = details.title || details.name || '';
    const originalTitle = details.original_title || details.original_name || '';
    let searchResults = [];
    
    // Strategy 1: Try the full title first
    try {
      searchResults = await this.search(title);
      if (searchResults.length > 0) {
        return searchResults;
      }
    } catch (error) {}
    
    // Strategy 2: Try the original title
    if (originalTitle && originalTitle !== title) {
      try {
        searchResults = await this.search(originalTitle);
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {}
    }
    
    // Strategy 3: Try main part of the title (before any colon or dash)
    const mainTitleMatch = title.match(/^([^:—–-]+)/);
    if (mainTitleMatch && mainTitleMatch[1].trim() !== title) {
      const mainTitle = mainTitleMatch[1].trim();
      try {
        searchResults = await this.search(mainTitle);
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {}
    }
    
    // Strategy 4: Try with the first few words of the title
    const words = title.split(' ');
    if (words.length > 2) {
      const shortTitle = words.slice(0, 3).join(' '); // First 3 words
      try {
        searchResults = await this.search(shortTitle);
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {}
    }
    
    return [];
  }

  /**
   * Get video URL using the download button and quality selection
   * @param {Object} page - Puppeteer page
   * @returns {Promise<string>} - Direct video URL
   */
  async getVideoUrl(page) {
    try {
      // Capture network requests to find video URLs as fallback
      const videoUrls = [];
      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        // Look for video content or m3u8 playlists
        if (contentType.includes('video/') || 
            url.includes('.mp4') || 
            url.includes('.m3u8') || 
            url.includes('/playlist/') ||
            url.endsWith('/master.json')) {
          videoUrls.push(url);
        }
      });
      
      // Act more human-like before clicking buttons
      await this.simulateHumanScrolling(page);
      await this.humanDelay(1500, 3500);
      await this.simulateHumanMouseMovement(page);
      
      // First try: Look for the download button and click it
      console.log('Looking for download button...');
      const downloadButtonSelector = '.pc-download-btn';
      const downloadButton = await page.$(downloadButtonSelector);
      
      if (!downloadButton) {
        console.log('Download button not found, trying alternative methods');
        return this.fallbackGetVideoUrl(page, videoUrls);
      }
      
      // Move mouse to the button before clicking (more human-like)
      const buttonBox = await downloadButton.boundingBox();
      if (buttonBox) {
        // Move to a random position within the button
        const x = buttonBox.x + buttonBox.width * (0.3 + Math.random() * 0.4);
        const y = buttonBox.y + buttonBox.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(x, y, { steps: 5 });
        await this.humanDelay(300, 800);
      }
      
      console.log('Download button found, clicking...');
      await downloadButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
      
      // Human-like delay before next action
      await this.humanDelay(800, 1500);
      
      // Wait for the quality selection modal to appear
      await page.waitForSelector('.pc-quality-list', { timeout: 5000 });
      
      // Find all quality options
      const qualityItems = await page.$$('.pc-quality-list .pc-itm');
      
      if (!qualityItems || qualityItems.length === 0) {
        console.log('No quality options found, trying alternative methods');
        return this.fallbackGetVideoUrl(page, videoUrls);
      }
      
      console.log(`Found ${qualityItems.length} quality options`);
      
      // Get the quality values
      const qualities = await Promise.all(qualityItems.map(async (option, index) => {
        const resolutionText = await page.evaluate(el => {
          const resEl = el.querySelector('.pc-resolution');
          return resEl ? resEl.textContent.trim() : '';
        }, option);
        
        return {
          element: option,
          index: index,
          resolution: resolutionText.toLowerCase()
        };
      }));
      
      console.log('Available qualities:', qualities.map(q => q.resolution).join(', '));
      
      // Find the highest quality option
      let highestQuality = qualities[0];
      
      // Look for 1080p or the highest available
      for (const quality of qualities) {
        if (quality.resolution.includes('1080p') || quality.resolution.includes('1080')) {
          highestQuality = quality;
          break;
        } else if (quality.resolution.includes('720p') && 
                  !highestQuality.resolution.includes('1080')) {
          highestQuality = quality;
        } else if (quality.resolution.includes('480p') && 
                  !highestQuality.resolution.includes('720') && 
                  !highestQuality.resolution.includes('1080')) {
          highestQuality = quality;
        }
      }
      
      console.log(`Selected highest quality: ${highestQuality.resolution}`);
      
      // Move mouse to the quality option before clicking (human-like)
      const qualityBox = await highestQuality.element.boundingBox();
      if (qualityBox) {
        const x = qualityBox.x + qualityBox.width * (0.3 + Math.random() * 0.4);
        const y = qualityBox.y + qualityBox.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(x, y, { steps: 3 });
        await this.humanDelay(200, 500);
      }
      
      // Create a promise to capture the download URL
      const downloadUrlPromise = new Promise((resolve) => {
        page.on('request', request => {
          const url = request.url();
          if (url.includes('.mp4') || url.includes('/download/')) {
            resolve(url);
          }
        });
      });
      
      // Click on the highest quality option with a human-like delay
      await highestQuality.element.click({ delay: Math.floor(Math.random() * 50) + 30 });
      
      // Wait for the download to start and capture the URL (with timeout)
      const downloadUrl = await Promise.race([
        downloadUrlPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Download URL capture timeout')), 10000))
      ]).catch(error => {
        console.error('Error capturing download URL:', error.message);
        return null;
      });
      
      if (downloadUrl) {
        console.log('Successfully captured download URL:', downloadUrl);
        
        // Sometimes humans cancel downloads - simulate by not actually downloading
        // but we've already captured the URL so we're good
        if (Math.random() > 0.8) {
          await page.keyboard.press('Escape');
        }
        
        return downloadUrl;
      }
      
      // If we couldn't get the URL from the download action, try fallback methods
      console.log('Failed to capture download URL, trying fallback methods');
      return this.fallbackGetVideoUrl(page, videoUrls);
    } catch (error) {
      console.error(`Error extracting video URL via download: ${error.message}`);
      // Try fallback method if download approach fails
      return this.fallbackGetVideoUrl(page, []);
    }
  }

  /**
   * Fallback method to get video URL if download button approach fails
   * @param {Object} page - Puppeteer page
   * @param {Array} capturedVideoUrls - Video URLs captured from network requests
   * @returns {Promise<string>} - Direct video URL
   */
  async fallbackGetVideoUrl(page, capturedVideoUrls = []) {
    try {
      console.log('Using fallback method to get video URL');
      
      // Add human-like behaviors before checking for video
      await this.simulateHumanScrolling(page);
      await this.simulateHumanMouseMovement(page);
      
      // First try: Check specifically for .art-video element
      let videoUrl = await page.evaluate(() => {
        const artVideo = document.querySelector('.art-video');
        if (artVideo && artVideo.src && artVideo.src.length > 0) {
          return artVideo.src;
        }
        return null;
      });
      
      if (videoUrl) {
        console.log('Found video URL from .art-video element:', videoUrl);
        return videoUrl;
      }
      
      console.log('Art-video element not found, trying alternative methods');
      
      // Try clicking on the video player area to start playback
      await page.evaluate(() => {
        const playerElements = [
          '.art-video-player',
          '.pc-player-cot',
          '.player-container',
          '#player'
        ];
        
        for (const selector of playerElements) {
          const player = document.querySelector(selector);
          if (player) {
            player.click();
            break;
          }
        }
      });
      
      // Human-like delay after clicking
      await this.humanDelay(1000, 2500);
      
      // Check again for the art-video element after clicking
      videoUrl = await page.evaluate(() => {
        const artVideo = document.querySelector('.art-video');
        if (artVideo && artVideo.src && artVideo.src.length > 0) {
          return artVideo.src;
        }
        return null;
      });
      
      if (videoUrl) {
        console.log('Found video URL after clicking player:', videoUrl);
        return videoUrl;
      }
      
      // Check for all video elements on the page
      videoUrl = await page.evaluate(() => {
        const videoElements = document.querySelectorAll('video');
        for (const video of videoElements) {
          if (video.src && video.src.length > 0) {
            return video.src;
          }
        }
        return null;
      });
      
      if (videoUrl) {
        console.log('Found video URL from generic video element:', videoUrl);
        return videoUrl;
      }
      
      // Check if any network requests captured video URLs
      if (capturedVideoUrls.length > 0) {
        // Prefer .mp4 over other formats
        const mp4Urls = capturedVideoUrls.filter(url => url.includes('.mp4'));
        if (mp4Urls.length > 0) {
          console.log('Found MP4 URL from network requests:', mp4Urls[0]);
          return mp4Urls[0];
        }
        
        console.log('Found video URL from network requests:', capturedVideoUrls[0]);
        return capturedVideoUrls[0];
      }
      
      // Take a screenshot for debugging
      const screenshotPath = `./video-player-debug-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      throw new Error('No video URL found on page');
    } catch (error) {
      console.error(`Error in fallback video URL extraction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Simulate human-like mouse movement on the page
   * @param {Object} page - Puppeteer page
   */
  async simulateHumanMouseMovement(page) {
    try {
      const viewportSize = await page.viewport();
      
      // Create 3-5 random points for mouse to move through
      const points = [];
      const numPoints = Math.floor(Math.random() * 3) + 3;
      
      for (let i = 0; i < numPoints; i++) {
        points.push({
          x: Math.floor(Math.random() * viewportSize.width),
          y: Math.floor(Math.random() * viewportSize.height)
        });
      }
      
      // Move mouse through random points with human-like timing
      for (const point of points) {
        await page.mouse.move(point.x, point.y, { steps: Math.floor(Math.random() * 5) + 3 });
        await this.humanDelay(100, 800);
      }
    } catch (error) {
      // Silently handle errors - mouse movement is non-critical
    }
  }
  
  /**
   * Simulate human-like scrolling behavior
   * @param {Object} page - Puppeteer page
   */
  async simulateHumanScrolling(page) {
    try {
      // Get page height
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      
      // Determine number of scroll actions (random)
      const scrollCount = Math.floor(Math.random() * 3) + 2;
      const scrollDistance = Math.floor(bodyHeight / scrollCount);
      
      let currentPosition = 0;
      
      // Perform scrolling with random pauses
      for (let i = 0; i < scrollCount; i++) {
        // Random scroll distance within reasonable range
        const scrollPixels = scrollDistance + Math.floor(Math.random() * 100) - 50;
        currentPosition += scrollPixels;
        
        // Execute scroll with smooth behavior
        await page.evaluate((scrollPos) => {
          window.scrollTo({
            top: scrollPos,
            behavior: 'smooth'
          });
        }, currentPosition);
        
        // Random pause between scrolls like a human would do
        await this.humanDelay(500, 2000);
      }
    } catch (error) {
      // Silently handle errors - scrolling is non-critical
    }
  }

  /**
   * Apply enhanced page configuration for better human simulation
   * @param {Object} page - Puppeteer page
   */
  async applyEnhancedPageHeaders(page) {
    // Set user agent and headers
    await page.setUserAgent(this.headers['User-Agent']);
    
    // Filter out null headers
    const cleanedHeaders = {};
    for (const [key, value] of Object.entries(this.headers)) {
      if (value !== null) {
        cleanedHeaders[key] = value;
      }
    }
    
    await page.setExtraHTTPHeaders(cleanedHeaders);
    
    // Set viewport to match the user agent
    const isMobile = this.headers['Sec-Ch-Ua-Mobile'] === '?1';
    const viewportIndex = isMobile ? 
      Math.floor(Math.random() * 2) : // Mobile viewport (smaller options)
      Math.floor(Math.random() * (this.screenResolutions.length - 2)) + 2; // Desktop viewport
    
    const viewport = this.screenResolutions[viewportIndex];
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: Math.random() > 0.5 ? 2 : 1, // Randomize between retina and non-retina
      isMobile: isMobile,
      hasTouch: isMobile,
    });
    
    // Set realistic browser behavior
    await page.evaluateOnNewDocument(() => {
      // Override referrer
      Object.defineProperty(document, 'referrer', { get: () => 'https://www.google.com/' });
      
      // Add common plugins array that most browsers have
      Object.defineProperty(navigator, 'plugins', { 
        get: () => {
          return [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client' }
          ];
        }
      });
      
      // Common screen properties
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      
      // Add common browser functions
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        },
        runtime: {
          PlatformOs: {
            MAC: 'mac',
            WIN: 'win',
            ANDROID: 'android',
            CROS: 'cros',
            LINUX: 'linux',
            OPENBSD: 'openbsd'
          },
          PlatformArch: {
            ARM: 'arm',
            X86_32: 'x86-32',
            X86_64: 'x86-64'
          },
          PlatformNaclArch: {
            ARM: 'arm',
            X86_32: 'x86-32',
            X86_64: 'x86-64'
          },
          RequestUpdateCheckStatus: {
            THROTTLED: 'throttled',
            NO_UPDATE: 'no_update',
            UPDATE_AVAILABLE: 'update_available'
          }
        }
      };
      
      // Override webdriver property
      const _originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return _originalQuery(parameters);
      };
      
      // Override toString methods which often reveal automation
      const originalFunction = Function.prototype.toString;
      Function.prototype.toString = function() {
        if (this === Function.prototype.toString) return originalFunction.call(this);
        if (this === window.navigator.permissions.query) {
          return "function query() { [native code] }";
        }
        return originalFunction.call(this);
      };
    });
    
    // Set realistic cookies
    await page.setCookie({
      name: '_ga',
      value: `GA1.2.${Math.floor(Math.random() * 1000000000)}.${Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 10000000)}`,
      domain: '.aoneroom.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 86400 * 30,
      httpOnly: false,
      secure: true,
      sameSite: 'None'
    });
    
    // Automatically accept dialogs
    page.on('dialog', async dialog => {
      await dialog.accept();
    });
  }

  /**
   * Get movie by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getMovieByTmdbId(req, res) {
    let browser, page;
    try {
      const tmdbId = req.params.tmdbId;
      
      // Get movie details from TMDB
      const movieDetails = await this.getMovieDetailsFromTMDB(tmdbId);
      
      // Get title for better search results
      const title = movieDetails.title || movieDetails.original_title;
      
      // Search for the movie on MovieBox
      const searchResults = await this.enhancedSearch(movieDetails);
      
      if (searchResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Movie not found on MovieBox',
          error_details: {
            search_query: title,
            tmdb_id: tmdbId,
            type: 'movie',
            timestamp: new Date().toISOString()
          }
        });
      }
      
      // Get the first result (most relevant)
      const movie = searchResults[0];
      
      // Now we need to click on the result and get the video URL
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Set up request interception but allow more resources
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        // Allow resources that might be related to video player
        if (resourceType === 'media' || 
            url.includes('.mp4') || 
            url.includes('.m3u8') || 
            url.includes('playlist') || 
            url.includes('player')) {
          request.continue();
        } 
        // Block less important resources
        else if (['image', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(45000);
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait for search results to load
      await page.waitForSelector('.pc-card', { timeout: 20000 });
      
      // Click on the movie card
      const cardSelector = '.pc-card';
      const cards = await page.$$(cardSelector);
      
      if (cards.length <= movie.cardIndex) {
        throw new Error(`Card at index ${movie.cardIndex} not found, only ${cards.length} cards available`);
      }
      
      // Get actual card title to confirm selection
      const cardTitle = await page.evaluate(el => {
        const titleEl = el.querySelector('.pc-card-title');
        return titleEl ? titleEl.textContent.trim() : 'Unknown';
      }, cards[movie.cardIndex]);
      
      // Click on the "Watch now" button for this card with human behavior
      const watchButton = await cards[movie.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      // Apply human-like behavior
      await this.simulateHumanScrolling(page);
      await this.simulateHumanMouseMovement(page);
      await this.humanDelay(800, 2000);
      await this.humanClick(page, watchButton);
      
      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait a bit for page to initialize
      await this.humanDelay(2000);
      
      // Get video URL with our enhanced method
      const videoUrl = await this.getVideoUrl(page);
      
      // Upload to Bunny Stream in the background
      bunnyStreamController.uploadVideoToCollection(videoUrl, {
        title: movie.title,
        type: 'movie',
        tmdbId: tmdbId,
        year: movieDetails.release_date ? new Date(movieDetails.release_date).getFullYear() : null
      });
      
      await page.close();
      
      return res.json({
        success: true,
        title: movie.title,
        poster: movie.image,
        rating: movie.rating,
        player_url: videoUrl
      });
    } catch (error) {
      console.error(`Error getting movie from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          await page.close().catch(() => {});
        } catch (contentError) {}
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie from MovieBox',
        error: error.message,
        error_details: {
          stack: error.stack.split('\n')[0],
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Get TV episode by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getTvEpisodeByTmdbId(req, res) {
    let browser, page;
    try {
      const tmdbId = req.params.tmdbId;
      const season = parseInt(req.query.season, 10);
      const episode = parseInt(req.query.episode, 10);
      
      console.log(`Processing request for TMDB ID: ${tmdbId}, Season: ${season}, Episode: ${episode}`);
      
      if (isNaN(season) || isNaN(episode)) {
        return res.status(400).json({
          success: false,
          message: 'Season and episode numbers are required',
          error_details: {
            provided_season: req.query.season,
            provided_episode: req.query.episode,
            tmdb_id: tmdbId
          }
        });
      }
      
      // Get TV details from TMDB
      const tvDetails = await this.getTVDetailsFromTMDB(tmdbId);
      
      // Get title for better search results
      const title = tvDetails.name || tvDetails.original_name;
      
      // Search for the TV show on MovieBox
      const searchResults = await this.enhancedSearch(tvDetails);
      
      if (searchResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'TV show not found on MovieBox',
          error_details: {
            search_query: title,
            tmdb_id: tmdbId,
            type: 'tv',
            requested_season: season,
            requested_episode: episode,
            timestamp: new Date().toISOString()
          }
        });
      }
      
      // Get the first result (most relevant)
      const show = searchResults[0];
      
      // Now we need to click on the result, select season and episode, and get the video URL
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Set up request interception for better performance
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        // Allow resources that might be related to video player
        if (resourceType === 'media' || 
            url.includes('.mp4') || 
            url.includes('.m3u8') || 
            url.includes('playlist') || 
            url.includes('player')) {
          request.continue();
        } 
        // Block less important resources
        else if (['image', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(60000); // Increased from 45000
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 }); // Changed from domcontentloaded to networkidle2
      
      // Wait for search results to load with increased timeout
      await page.waitForSelector('.pc-card', { timeout: 30000 }); // Increased from 20000
      
      // Click on the show card
      const cardSelector = '.pc-card';
      const cards = await page.$$(cardSelector);
      
      if (cards.length <= show.cardIndex) {
        throw new Error(`Card at index ${show.cardIndex} not found, only ${cards.length} cards available`);
      }
      
      // Click on the "Watch now" button for this card with human behavior
      const watchButton = await cards[show.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      // Apply human-like behavior
      await this.simulateHumanScrolling(page);
      await this.simulateHumanMouseMovement(page);
      await this.humanDelay(1000, 2500);
      await this.humanClick(page, watchButton);
      
      // Wait longer for page to initialize
      await this.humanDelay(5000); // Increased from 2000
      
      console.log(`Clicked on search result: ${show.title}`);
      console.log('Navigation completed, waiting for page to stabilize');
      
      // Try multiple episode selector strategies
      let foundEpisodes = false;
      
      // Strategy 1: Check for the primary episode selector
      try {
        await page.waitForSelector('.pc-ep-contain', { timeout: 10000 });
        foundEpisodes = true;
        console.log('Found episodes using primary selector');
      } catch (err) {
        console.log('Primary episode selector not found, trying alternatives');
      }
      
      // Strategy 2: Check for alternative episode selectors
      if (!foundEpisodes) {
        try {
          // Try alternatives - common parent elements
          const alternativeSelectors = [
            '.pc-ep-box',
            '.pc-tv-box',
            '.pc-tv-box-inner',
            '[data-v-d63b58d4].pc-ep-box',
            '.flx-sta-sta'
          ];
          
          for (const selector of alternativeSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 5000 });
              console.log(`Found alternative selector: ${selector}`);
              foundEpisodes = true;
              break;
            } catch (err) {
              // Continue to next selector
            }
          }
        } catch (err) {
          console.log('Alternative selectors also failed');
        }
      }
      
      // Strategy 3: Just look for episode elements directly
      if (!foundEpisodes) {
        try {
          await page.waitForSelector('.pc-ep', { timeout: 10000 });
          foundEpisodes = true;
          console.log('Found episodes using direct element selector');
        } catch (err) {
          console.log('Direct episode selector not found');
        }
      }
      
      // Take screenshot for debugging if no episodes found
      if (!foundEpisodes) {
        const screenshotPath = `./debug-tv-page-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Page screenshot saved to ${screenshotPath}`);
        throw new Error('No episode selectors found on page');
      }
      
      // Use a more reliable approach to select the episode
      try {
        // Get all episode elements
        const episodeElements = await page.$$('.pc-ep');
        
        if (episodeElements.length === 0) {
          // Try direct DOM evaluation as a fallback
          const episodeFound = await page.evaluate((targetEpisode) => {
            // Look for any elements that might contain episode numbers
            const possibleEpisodeElements = Array.from(document.querySelectorAll('*'))
              .filter(el => {
                const text = el.textContent.trim();
                return text === targetEpisode.toString().padStart(2, '0') || 
                       text === targetEpisode.toString();
              });
            
            if (possibleEpisodeElements.length > 0) {
              // Click the first matching element
              possibleEpisodeElements[0].click();
              return true;
            }
            return false;
          }, episode);
          
          if (!episodeFound) {
            throw new Error(`No episode elements found for episode ${episode}`);
          }
        } else {
          console.log(`Found ${episodeElements.length} episode elements`);
          
          // Check for episode by attribute or text content
          let found = false;
          for (let i = 0; i < episodeElements.length; i++) {
            const episodeText = await page.evaluate(el => {
              const span = el.querySelector('span');
              return span ? span.textContent.trim() : '';
            }, episodeElements[i]);
            
            // Match either padded (01) or unpadded (1) format
            if (episodeText === episode.toString().padStart(2, '0') || 
                episodeText === episode.toString()) {
              await episodeElements[i].click();
              found = true;
              console.log(`Clicked on episode ${episodeText}`);
              break;
            }
          }
          
          // If specific episode not found, try just clicking on first episode
          if (!found && episodeElements.length > 0) {
            if (episode <= episodeElements.length) {
              await episodeElements[episode-1].click();
              console.log(`Clicked on episode at index ${episode-1}`);
              found = true;
            } else {
              throw new Error(`Episode ${episode} is greater than available episodes (${episodeElements.length})`);
            }
          }
          
          if (!found) {
            throw new Error(`Could not find element for episode ${episode}`);
          }
        }
      } catch (episodeError) {
        throw new Error(`Failed to select episode ${episode}: ${episodeError.message}`);
      }
      
      // Wait longer for video player to load after selecting episode
      await this.humanDelay(5000); // Increased from 3000
      
      // Get video URL with enhanced timeout
      const videoUrl = await this.getVideoUrl(page);
      
      // Upload to Bunny Stream in the background
      bunnyStreamController.uploadVideoToCollection(videoUrl, {
        title: `${show.title} - S${season}E${episode}`,
        type: 'tv',
        tmdbId: tmdbId,
        season: season,
        episode: episode
      });
      
      await page.close();
      
      return res.json({
        success: true,
        title: `${show.title} - S${season}E${episode}`,
        poster: show.image,
        rating: show.rating,
        player_url: videoUrl
      });
    } catch (error) {
      console.error(`Error getting TV episode from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          // Capture screenshot of failed page for debugging
          const errorScreenshotPath = `./error-tv-page-${Date.now()}.png`;
          await page.screenshot({ path: errorScreenshotPath, fullPage: true });
          console.log(`Error screenshot saved to ${errorScreenshotPath}`);
          
          await page.close().catch(() => {});
        } catch (contentError) {}
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get TV episode from MovieBox',
        error: error.message,
        error_details: {
          stack: error.stack.split('\n')[0],
          timestamp: new Date().toISOString(),
          request_params: {
            tmdb_id: req.params.tmdbId,
            season: req.query.season,
            episode: req.query.episode
          }
        }
      });
    }
  }

  /**
   * Helper method to perform human-like click on elements
   * @param {Object} page - Puppeteer page
   * @param {Object} element - Page element to click
   */
  async humanClick(page, element) {
    try {
      const box = await element.boundingBox();
      if (box) {
        // Move to a random position within the element
        const x = box.x + box.width * (0.3 + Math.random() * 0.4);
        const y = box.y + box.height * (0.3 + Math.random() * 0.4);
        
        // Move mouse with multiple steps (more human-like)
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 4) + 2 });
        
        // Small delay before clicking (human reaction time)
        await this.humanDelay(50, 200);
        
        // Click with a random delay
        await page.mouse.click(x, y, { delay: Math.floor(Math.random() * 100) + 30 });
      } else {
        // Fallback to element.click() if boundingBox isn't available
        await element.click({ delay: Math.floor(Math.random() * 100) + 30 });
      }
    } catch (error) {
      // Fallback to regular click if human click fails
      await element.click();
    }
  }
}

export const movieboxController = new MovieBoxController(); 