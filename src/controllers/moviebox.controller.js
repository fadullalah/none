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
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
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
      'Connection': 'keep-alive'
    };
    
    // Set up browser cleanup interval
    setInterval(this.cleanupBrowser.bind(this), 60000); // Check every minute
    
    // Setup header rotation interval
    setInterval(this.rotateUserAgent.bind(this), 600000); // Rotate user agent every 10 minutes
  }
  
  /**
   * Rotate user agent to avoid detection patterns
   */
  rotateUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/123.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ];
    
    // Select a random user agent
    const randomAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    this.headers['User-Agent'] = randomAgent;
    console.log('Rotated MovieBox user agent to:', randomAgent);
  }

  /**
   * Get or create a browser instance
   * @returns {Promise<Browser>} Puppeteer browser instance
   */
  async getBrowser() {
    if (!browserInstance) {
      console.log('Creating new browser instance for MovieBox');
      browserInstance = await puppeteerExtra.launch({
        headless: "new",  // Use new headless mode
        defaultViewport: {
          width: 1366,
          height: 768
        },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-dev-shm-usage',
          '--js-flags=--expose-gc',
          '--disable-gpu',
          '--window-size=1366,768',
          '--disable-notifications',
          '--disable-infobars'
        ],
        ignoreDefaultArgs: ['--enable-automation'] // Hide automation
      });
    }
    
    browserLastUsed = Date.now();
    return browserInstance;
  }

  /**
   * Clean up browser if idle for too long
   */
  async cleanupBrowser() {
    if (browserInstance && Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
      console.log('Closing idle browser instance');
      await browserInstance.close();
      browserInstance = null;
    }
  }

  /**
   * Get movie details from TMDB API
   * @param {string} tmdbId - TMDB ID of the movie
   * @returns {Promise<Object>} - Movie details
   */
  async getMovieDetailsFromTMDB(tmdbId) {
    const cacheKey = `tmdb_movie_${tmdbId}`;
    
    // Check cache first
    const cachedDetails = movieboxCache.get(cacheKey);
    if (cachedDetails) {
      console.log(`Using cached TMDB movie details for ID ${tmdbId}`);
      return cachedDetails;
    }
    
    try {
      const url = `${this.tmdbApiBaseUrl}/movie/${tmdbId}?api_key=${this.tmdbApiKey}&language=en-US`;
      const response = await axios.get(url, { headers: this.headers });
      
      // Cache the results
      movieboxCache.set(cacheKey, response.data, 86400); // Cache for 24 hours
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
    const cacheKey = `tmdb_tv_${tmdbId}`;
    
    // Check cache first
    const cachedDetails = movieboxCache.get(cacheKey);
    if (cachedDetails) {
      console.log(`Using cached TMDB TV details for ID ${tmdbId}`);
      return cachedDetails;
    }
    
    try {
      const url = `${this.tmdbApiBaseUrl}/tv/${tmdbId}?api_key=${this.tmdbApiKey}&language=en-US`;
      const response = await axios.get(url, { headers: this.headers });
      
      // Cache the results
      movieboxCache.set(cacheKey, response.data, 86400); // Cache for 24 hours
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
    
    // Check cache first
    const cachedResults = movieboxCache.get(cacheKey);
    if (cachedResults) {
      console.log(`Using cached search results for "${query}"`);
      return cachedResults;
    }
    
    const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(query)}`;
    console.log(`Searching MovieBox: ${searchUrl}`);
    
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
      
      console.log(`Navigating to: ${searchUrl}`);
      
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
      await page.waitForSelector('.pc-card', { timeout: 10000 }).catch(() => {
        console.log('Search results selector not found, page might be empty');
      });
      
      // Extract search results
      const searchResults = await page.evaluate(() => {
        const shows = [];
        const cards = document.querySelectorAll('.pc-card');
        
        if (cards.length === 0) {
          // Log detailed page structure for debugging if no results found
          console.log('No cards found on page');
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
      
      // Add caching of results before returning
      movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
      return searchResults;
    } catch (error) {
      console.error(`Error searching MovieBox: ${error.message}`);
      
      if (page) {
        try {
          const content = await page.content();
          console.error(`Page content sample: ${content.substring(0, 500)}...`);
        } catch (contentError) {
          console.error(`Could not capture page content: ${contentError.message}`);
        }
        
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
    // Generate a cache key based on details
    const detailsHash = JSON.stringify(details).slice(0, 100); // First 100 chars as hash
    const cacheKey = `moviebox_enhanced_search_${Buffer.from(detailsHash).toString('base64')}`;
    
    // Check cache first
    const cachedResults = movieboxCache.get(cacheKey);
    if (cachedResults) {
      console.log(`Using cached enhanced search results`);
      return cachedResults;
    }
    
    const title = details.title || details.name || '';
    const originalTitle = details.original_title || details.original_name || '';
    const allSearchAttempts = [];
    let searchResults = [];
    
    console.log(`Starting enhanced MovieBox search for: "${title}" (Original: "${originalTitle}")`);
    
    // Strategy 1: Try the full title first
    try {
      searchResults = await this.search(title);
      console.log(`Strategy 1 (Full title): Found ${searchResults.length} results`);
      allSearchAttempts.push({ query: title, results: searchResults.length });
      
      if (searchResults.length > 0) {
        // Add caching of results before returning
        movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
        return searchResults;
      }
    } catch (error) {
      console.error(`Error in strategy 1: ${error.message}`);
    }
    
    // Strategy 2: Try the original title
    if (originalTitle && originalTitle !== title) {
      try {
        searchResults = await this.search(originalTitle);
        console.log(`Strategy 2 (Original title): Found ${searchResults.length} results`);
        allSearchAttempts.push({ query: originalTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          // Add caching of results before returning
          movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 2: ${error.message}`);
      }
    }
    
    // Strategy 3: Try main part of the title (before any colon or dash)
    const mainTitleMatch = title.match(/^([^:—–-]+)/);
    if (mainTitleMatch && mainTitleMatch[1].trim() !== title) {
      const mainTitle = mainTitleMatch[1].trim();
      try {
        searchResults = await this.search(mainTitle);
        console.log(`Strategy 3 (Main part of title): "${mainTitle}" found ${searchResults.length} results`);
        allSearchAttempts.push({ query: mainTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          // Add caching of results before returning
          movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 3: ${error.message}`);
      }
    }
    
    // Strategy 4: Try with the first few words of the title
    const words = title.split(' ');
    if (words.length > 2) {
      const shortTitle = words.slice(0, 3).join(' '); // First 3 words
      try {
        searchResults = await this.search(shortTitle);
        console.log(`Strategy 4 (First few words): "${shortTitle}" found ${searchResults.length} results`);
        allSearchAttempts.push({ query: shortTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          // Add caching of results before returning
          movieboxCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 4: ${error.message}`);
      }
    }
    
    console.log('All search strategies exhausted. Search attempts:', allSearchAttempts);
    // Add caching of results before returning
    movieboxCache.set(cacheKey, [], 21600); // Cache for 6 hours
    return [];
  }

  /**
   * Select the highest video quality available
   * @param {Object} page - Puppeteer page
   * @returns {Promise<void>}
   */
  async selectHighestQuality(page) {
    try {
      console.log('Checking for quality selector...');
      
      // Check if quality selector exists
      const qualitySelector = await page.$('.art-control-quality');
      if (!qualitySelector) {
        console.log('No quality selector found on page');
        return;
      }
      
      console.log('Quality selector found, attempting to select highest quality');
      
      // Click on the quality selector to open the dropdown
      await qualitySelector.click();
      
      // Wait for the quality options to appear
      await delay(1000);
      
      // Find all quality options
      const qualityOptions = await page.$$('.art-selector-item');
      
      if (!qualityOptions || qualityOptions.length === 0) {
        console.log('No quality options found');
        return;
      }
      
      console.log(`Found ${qualityOptions.length} quality options`);
      
      // Get the quality values/labels
      const qualities = await Promise.all(qualityOptions.map(async (option) => {
        const text = await page.evaluate(el => el.textContent.trim(), option);
        return {
          element: option,
          text: text,
          value: text.toLowerCase() // Convert to lowercase for easier comparison
        };
      }));
      
      console.log('Available qualities:', qualities.map(q => q.text));
      
      // Define quality ranking
      const qualityRanking = {
        '4k': 5,
        '2160p': 5,
        '1080p': 4,
        '720p': 3,
        '480p': 2,
        '360p': 1
      };
      
      // Find the highest quality option
      let highestQuality = qualities[0];
      let highestRank = 0;
      
      for (const quality of qualities) {
        // Check against standard quality labels
        for (const [label, rank] of Object.entries(qualityRanking)) {
          if (quality.value.includes(label) && rank > highestRank) {
            highestQuality = quality;
            highestRank = rank;
          }
        }
        
        // Also check for direct numeric values (e.g., "1080")
        const numericMatch = quality.value.match(/(\d+)/);
        if (numericMatch) {
          const numeric = parseInt(numericMatch[1], 10);
          if (numeric > 0) {
            // Compare to highest found so far
            const currentHighestNumeric = parseInt(highestQuality.value.match(/(\d+)/)?.[1] || '0', 10);
            if (numeric > currentHighestNumeric && !highestRank) {
              highestQuality = quality;
            }
          }
        }
      }
      
      console.log(`Selected highest quality: ${highestQuality.text}`);
      
      // Click on the highest quality option
      await highestQuality.element.click();
      
      // Wait for video to adjust to new quality
      await delay(2000);
      
      console.log('Quality selection complete');
    } catch (error) {
      console.error(`Error selecting highest quality: ${error.message}`);
      // Continue execution even if quality selection fails
    }
  }

  /**
   * Get video URL from a movie or episode page
   * @param {Object} page - Puppeteer page
   * @returns {Promise<string>} - Direct video URL
   */
  async getVideoUrl(page) {
    // Since page is a Puppeteer page object, we need a different approach
    // We can extract the current URL from the page and use that as cache key
    const url = await page.url();
    const cacheKey = `moviebox_video_url_${Buffer.from(url).toString('base64')}`;
    
    // Check cache first
    const cachedUrl = movieboxCache.get(cacheKey);
    if (cachedUrl) {
      console.log(`Using cached video URL for ${url}`);
      return cachedUrl;
    }
    
    try {
      console.log(`Attempting to extract video URL from: ${page.url()}`);
      
      // Capture network requests to find video URLs
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
          console.log(`Potential video URL found in network: ${url}`);
          videoUrls.push(url);
        }
      });
      
      // Longer wait for the player to initialize
      console.log('Waiting for player to initialize...');
      await delay(3000);
      
      // Try to find player container first
      await page.waitForSelector('.pc-player-cot, .player-container, #player, .art-video-player', { 
        timeout: 10000 
      }).catch(() => {
        console.log('Player container not found, will try direct video element');
      });
      
      // Wait longer for video to appear
      await delay(2000);
      
      // NEW: Try to select the highest quality available
      await this.selectHighestQuality(page);
      
      // First try: DOM-based approach with multiple selectors
      console.log('Trying DOM-based video extraction...');
      let videoUrl = await page.evaluate(() => {
        // Check various selectors that might contain video URLs
        const selectors = [
          'video', 
          'video source',
          'iframe[src*="player"]',
          'iframe[src*="embed"]',
          '.pc-player-cot video',
          '.player-container video',
          '#player video',
          '.video-js video',
          '.art-video-player video',
          '[data-video-url]',
          '[data-src]'
        ];
        
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            // For video or source elements
            if (el.src && (el.src.includes('http') || el.src.startsWith('blob:'))) {
              console.log(`Found video URL in ${selector}:`, el.src);
              return el.src;
            }
            
            // For iframes
            if (el.tagName === 'IFRAME' && el.src) {
              console.log(`Found iframe source:`, el.src);
              return el.src; // We'll need to follow this iframe
            }
            
            // For elements with data attributes
            if (el.dataset) {
              if (el.dataset.videoUrl) return el.dataset.videoUrl;
              if (el.dataset.src) return el.dataset.src;
            }
          }
        }
        
        // Check for JSON data in script tags that might contain video URLs
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && (content.includes('.mp4') || content.includes('.m3u8'))) {
            const mp4Match = content.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
            if (mp4Match) return mp4Match[1];
            
            const m3u8Match = content.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
            if (m3u8Match) return m3u8Match[1];
          }
        }
        
        // Additional check for any video-like URL in the page
        const videoRegex = /(https?:\/\/[^"'\s]+\.(mp4|m3u8)[^"'\s]*)/i;
        const pageText = document.documentElement.outerHTML;
        const videoMatch = pageText.match(videoRegex);
        if (videoMatch) return videoMatch[1];
        
        return null;
      });
      
      // If we found a video URL through DOM methods, return it
      if (videoUrl) {
        console.log(`Found video URL through DOM: ${videoUrl}`);
        // Add caching of video URL before returning
        movieboxCache.set(cacheKey, videoUrl, 3600); // Cache for 1 hour
        return videoUrl;
      }
      
      // Second approach: Check if we captured any video URLs through network monitoring
      if (videoUrls.length > 0) {
        // Prefer .mp4 over other formats
        const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
        if (mp4Urls.length > 0) {
          console.log(`Using MP4 URL from network capture: ${mp4Urls[0]}`);
          // Add caching of video URL before returning
          movieboxCache.set(cacheKey, mp4Urls[0], 3600); // Cache for 1 hour
          return mp4Urls[0];
        }
        
        console.log(`Using URL from network capture: ${videoUrls[0]}`);
        // Add caching of video URL before returning
        movieboxCache.set(cacheKey, videoUrls[0], 3600); // Cache for 1 hour
        return videoUrls[0];
      }
      
      // Third approach: Try clicking on the play button if visible
      console.log('Trying to interact with player controls...');
      await delay(1000); // Using our custom delay
      
      const playButtonSelectors = [
        '.vjs-big-play-button', 
        '.play-button',
        '.pc-player-cot .play',
        '[aria-label="Play"]',
        '.player-control-play'
      ];
      
      for (const selector of playButtonSelectors) {
        const playButton = await page.$(selector);
        if (playButton) {
          console.log(`Found play button (${selector}), clicking it...`);
          await playButton.click().catch(() => console.log(`Failed to click ${selector}`));
          await delay(2000); // Using our custom delay
          break;
        }
      }
      
      // Fourth approach: Try executing player API if possible
      videoUrl = await page.evaluate(() => {
        // Try to access player objects
        if (window.player && typeof window.player.src === 'function') {
          return window.player.src();
        } else if (window.videojs && document.querySelector('.video-js')) {
          const vjsPlayer = window.videojs(document.querySelector('.video-js').id);
          if (vjsPlayer && vjsPlayer.src) return vjsPlayer.src();
        }
        
        // Last resort: check all src attributes in the page
        const allElements = document.querySelectorAll('*[src]');
        for (const el of allElements) {
          if (el.src && (
            el.src.includes('.mp4') || 
            el.src.includes('.m3u8') || 
            el.src.includes('/playlist') ||
            el.src.startsWith('blob:')
          )) {
            return el.src;
          }
        }
        
        return null;
      });
      
      if (videoUrl) {
        console.log(`Found video URL through player API or global scan: ${videoUrl}`);
        // Add caching of video URL before returning
        movieboxCache.set(cacheKey, videoUrl, 3600); // Cache for 1 hour
        return videoUrl;
      }
      
      // If we're here, we haven't found the video URL. Take a screenshot for debugging
      const timestamp = new Date().getTime();
      const screenshotPath = `./moviebox-debug-${timestamp}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved screenshot for debugging: ${screenshotPath}`);
      
      console.error('FAILED TO EXTRACT VIDEO URL');
      console.error('Current page URL:', page.url());
      console.error('Page title:', await page.title());
      
      // Check if we're on a page that might require user interaction
      const pageContentSample = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.error('Page content sample:', pageContentSample);
      
      throw new Error('No video URL found on page. A screenshot has been saved for debugging.');
    } catch (error) {
      console.error(`Error extracting video URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract subject ID from search results
   * @param {Object} page - Puppeteer page
   * @param {number} cardIndex - Index of the card to extract subject ID from
   * @returns {Promise<string|null>} - Subject ID
   */
  async extractSubjectId(page, cardIndex) {
    try {
      console.log(`Attempting to extract subject ID from card at index ${cardIndex}`);
      
      // First try to extract from network requests
      const subjectIdFromRequests = await page.evaluate(() => {
        if (window.performance && window.performance.getEntries) {
          const entries = window.performance.getEntries();
          for (const entry of entries) {
            if (entry.name && entry.name.includes('/subject/detail?subjectId=')) {
              const match = entry.name.match(/subjectId=([0-9]+)/);
              if (match && match[1]) return match[1];
            }
          }
        }
        return null;
      });
      
      if (subjectIdFromRequests) {
        console.log(`Found subject ID from network requests: ${subjectIdFromRequests}`);
        return subjectIdFromRequests;
      }
      
      // If that fails, click on the card to navigate and capture the ID from the URL
      const cards = await page.$$('.pc-card');
      if (cards.length <= cardIndex) {
        throw new Error(`Card at index ${cardIndex} not found, only ${cards.length} cards available`);
      }
      
      // Get actual card title to confirm selection
      const cardTitle = await page.evaluate(el => {
        const titleEl = el.querySelector('.pc-card-title');
        return titleEl ? titleEl.textContent.trim() : 'Unknown';
      }, cards[cardIndex]);
      
      console.log(`Clicking on card: "${cardTitle}" (index ${cardIndex})`);
      
      // Enable request interception to capture API requests
      await page.setRequestInterception(true);
      
      const subjectIdPromise = new Promise((resolve) => {
        page.on('request', request => {
          const url = request.url();
          if (url.includes('/subject/detail?subjectId=')) {
            const match = url.match(/subjectId=([0-9]+)/);
            if (match && match[1]) {
              console.log(`Captured subject ID from request: ${match[1]}`);
              resolve(match[1]);
            }
          }
          request.continue();
        });
        
        // Set a timeout to avoid hanging
        setTimeout(() => resolve(null), 10000);
      });
      
      // Click on the "Watch now" button for this card
      const watchButton = await cards[cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      await watchButton.click();
      
      // Wait for navigation or subject ID capture
      const subjectId = await subjectIdPromise;
      if (subjectId) {
        return subjectId;
      }
      
      // If we're here, we need to check the current URL
      const url = page.url();
      console.log(`Current page URL: ${url}`);
      
      // Check for detail URL pattern
      const subjectIdMatch = url.match(/\/detail\?subjectId=([0-9]+)/);
      if (subjectIdMatch && subjectIdMatch[1]) {
        console.log(`Extracted subject ID from URL: ${subjectIdMatch[1]}`);
        return subjectIdMatch[1];
      }
      
      // Last resort: look for any subject ID on the page
      const pageSubjectId = await page.evaluate(() => {
        // Check for API calls in the network log
        if (window.performance && window.performance.getEntries) {
          const entries = window.performance.getEntries();
          for (const entry of entries) {
            if (entry.name && (
                entry.name.includes('/subject/detail?subjectId=') || 
                entry.name.includes('/subject/play?subjectId=')
            )) {
              const match = entry.name.match(/subjectId=([0-9]+)/);
              if (match && match[1]) return match[1];
            }
          }
        }
        
        // Look for any data attributes on the page
        const dataElements = document.querySelectorAll('[data-id]');
        for (const el of dataElements) {
          if (el.dataset.id) return el.dataset.id;
        }
        
        // Look for IDs in page text content
        const pageText = document.body.innerText;
        const idMatch = pageText.match(/ID:\s*(\d+)/i);
        if (idMatch && idMatch[1]) return idMatch[1];
        
        return null;
      });
      
      if (pageSubjectId) {
        console.log(`Found subject ID from page evaluation: ${pageSubjectId}`);
        return pageSubjectId;
      }
      
      console.error('Failed to extract subject ID using all methods');
      return null;
    } catch (error) {
      console.error(`Error extracting subject ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Get direct API data for movie or TV show
   * @param {string} subjectId - Subject ID
   * @param {number|null} season - Season number for TV shows
   * @param {number|null} episode - Episode number for TV shows
   * @returns {Promise<Object>} - API response
   */
  async getDirectApiData(subjectId, season = null, episode = null) {
    try {
      let apiUrl = `${this.baseUrl}/wefeed-h5-bff/web/subject/play?subjectId=${subjectId}`;
      
      // Add season and episode parameters for TV shows
      if (season !== null && episode !== null) {
        apiUrl += `&se=${season}&ep=${episode}`;
      }
      
      console.log(`Fetching data from API: ${apiUrl}`);
      
      const response = await axios.get(apiUrl, {
        headers: this.headers,
        timeout: 30000
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error fetching API data: ${error.message}`);
      throw new Error(`Failed to fetch data from MovieBox API: ${error.message}`);
    }
  }

  /**
   * Extract video URL from API response
   * @param {Object} apiData - API response data
   * @returns {string|null} - Direct video URL
   */
  extractVideoUrlFromApiResponse(apiData) {
    try {
      console.log('Extracting video URL from API response');
      
      // Log a sample of the API data for debugging
      console.log('API data sample:', JSON.stringify(apiData).substring(0, 500));
      
      // Check common paths in the API response where video URLs might be found
      if (apiData.data && apiData.data.videoInfo && apiData.data.videoInfo.url) {
        return apiData.data.videoInfo.url;
      }
      
      if (apiData.data && apiData.data.url) {
        return apiData.data.url;
      }
      
      if (apiData.data && apiData.data.playInfo && apiData.data.playInfo.url) {
        return apiData.data.playInfo.url;
      }
      
      // Check for m3u8 or mp4 URLs anywhere in the response
      const apiDataStr = JSON.stringify(apiData);
      const m3u8Match = apiDataStr.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
      if (m3u8Match && m3u8Match[1]) {
        return m3u8Match[1];
      }
      
      const mp4Match = apiDataStr.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
      if (mp4Match && mp4Match[1]) {
        return mp4Match[1];
      }
      
      console.error('No video URL found in API response');
      return null;
    } catch (error) {
      console.error(`Error extracting video URL from API response: ${error.message}`);
      return null;
    }
  }

  /**
   * Get movie by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getMovieByTmdbId(req, res) {
    const tmdbId = req.params.tmdbId;
    const cacheKey = `moviebox_movie_${tmdbId}`;
    
    // Check cache first
    const cachedResponse = movieboxCache.get(cacheKey);
    if (cachedResponse) {
      console.log(`Using cached movie details for TMDB ID ${tmdbId}`);
      return res.json(cachedResponse);
    }
    
    let browser, page;
    try {
      // Get movie details from TMDB
      const movieDetails = await this.getMovieDetailsFromTMDB(tmdbId);
      
      // Get title for better search results
      const title = movieDetails.title || movieDetails.original_title;
      
      console.log(`Processing movie request for: "${title}" (TMDB ID: ${tmdbId})`);
      
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
      console.log(`Found movie: "${movie.title}" (Rating: ${movie.rating})`);
      
      // Now we need to extract the subjectId
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(45000);
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      console.log(`Navigating to search page: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait for search results to load
      await page.waitForSelector('.pc-card', { timeout: 20000 });
      
      // Extract the subject ID
      const subjectId = await this.extractSubjectId(page, movie.cardIndex);
      
      if (!subjectId) {
        throw new Error('Failed to extract subject ID for movie');
      }
      
      // Close the page as we don't need it anymore
      await page.close();
      
      // Get data directly from the API
      const apiData = await this.getDirectApiData(subjectId);
      
      // Extract video URL from API response
      const videoUrl = this.extractVideoUrlFromApiResponse(apiData);
      
      if (!videoUrl) {
        throw new Error('Failed to extract video URL from API response');
      }
      
      // Upload to Bunny Stream in the background
      bunnyStreamController.uploadVideoToCollection(videoUrl, {
        title: movie.title,
        type: 'movie',
        tmdbId: tmdbId,
        year: movieDetails.release_date ? new Date(movieDetails.release_date).getFullYear() : null
      });
      
      // Cache the successful response
      const responseData = {
        success: true,
        title: movie.title,
        poster: movie.image,
        rating: movie.rating,
        player_url: videoUrl,
        api_data: apiData // Include the API data for debugging or additional info
      };
      
      movieboxCache.set(cacheKey, responseData, 7200); // Cache for 2 hours
      return res.json(responseData);
    } catch (error) {
      console.error(`Error getting movie from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          const url = await page.url();
          console.error(`Current URL: ${url}`);
          await page.close().catch(() => {});
        } catch (contentError) {
          console.error(`Could not capture page URL: ${contentError.message}`);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie from MovieBox',
        error: error.message
      });
    }
  }

  /**
   * Get TV episode by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getTvEpisodeByTmdbId(req, res) {
    const tmdbId = req.params.tmdbId;
    const season = parseInt(req.query.season, 10);
    const episode = parseInt(req.query.episode, 10);
    
    const cacheKey = `moviebox_tv_${tmdbId}_s${season}_e${episode}`;
    
    // Check cache first
    const cachedResponse = movieboxCache.get(cacheKey);
    if (cachedResponse) {
      console.log(`Using cached TV episode details for TMDB ID ${tmdbId}, S${season}E${episode}`);
      return res.json(cachedResponse);
    }
    
    let browser, page;
    try {
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
      console.log(`Processing TV request for: "${tvDetails.name}" (TMDB ID: ${tmdbId}, Season: ${season}, Episode: ${episode})`);
      
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
      console.log(`Found TV show: "${show.title}" (Rating: ${show.rating})`);
      
      // Now we need to extract the subjectId
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(45000);
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      console.log(`Navigating to search page: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait for search results to load
      await page.waitForSelector('.pc-card', { timeout: 20000 });
      
      // Extract the subject ID
      const subjectId = await this.extractSubjectId(page, show.cardIndex);
      
      if (!subjectId) {
        throw new Error('Failed to extract subject ID for TV show');
      }
      
      // Close the page as we don't need it anymore
      await page.close();
      
      // Get data directly from the API with season and episode parameters
      const apiData = await this.getDirectApiData(subjectId, season, episode);
      
      // Extract video URL from API response
      const videoUrl = this.extractVideoUrlFromApiResponse(apiData);
      
      if (!videoUrl) {
        throw new Error('Failed to extract video URL from API response');
      }
      
      // Upload to Bunny Stream in the background
      bunnyStreamController.uploadVideoToCollection(videoUrl, {
        title: `${show.title} - S${season}E${episode}`,
        type: 'tv',
        tmdbId: tmdbId,
        season: season,
        episode: episode
      });
      
      // Cache the successful response
      const responseData = {
        success: true,
        title: `${show.title} - S${season}E${episode}`,
        poster: show.image,
        rating: show.rating,
        player_url: videoUrl,
        api_data: apiData // Include the API data for debugging or additional info
      };
      
      movieboxCache.set(cacheKey, responseData, 7200); // Cache for 2 hours
      return res.json(responseData);
    } catch (error) {
      console.error(`Error getting TV episode from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          const url = await page.url();
          console.error(`Current URL: ${url}`);
          await page.close().catch(() => {});
        } catch (contentError) {
          console.error(`Could not capture page URL: ${contentError.message}`);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get TV episode from MovieBox',
        error: error.message,
        error_details: {
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
   * Apply enhanced headers to request
   * @param {Object} page - Puppeteer page
   */
  async applyEnhancedPageHeaders(page) {
    await page.setUserAgent(this.headers['User-Agent']);
    await page.setExtraHTTPHeaders(this.headers);
    
    // Set Google as the referrer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(document, 'referrer', { get: () => 'https://www.google.com/' });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
  }

  /**
   * Capture subtitle/caption URL during navigation
   * @param {Object} page - Puppeteer page
   * @returns {Promise<Object>} - Subtitle information
   */
  async captureSubtitleUrl(page) {
    return new Promise((resolve) => {
      let capturedSubtitleData = null;
      
      // Listen for requests to the caption API
      page.on('request', request => {
        const url = request.url();
        if (url.includes('/wefeed-h5-bff/web/subject/caption')) {
          console.log(`Subtitle URL captured: ${url}`);
          capturedSubtitleData = {
            url: url,
            params: Object.fromEntries(new URL(url).searchParams)
          };
          resolve(capturedSubtitleData);
        }
      });
      
      // Set a timeout in case subtitle URL is not found
      setTimeout(() => {
        if (!capturedSubtitleData) {
          resolve(null);
        }
      }, 15000); // 15 seconds timeout
    });
  }

  /**
   * Get movie subtitles by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getMovieSubtitlesByTmdbId(req, res) {
    let browser, page;
    try {
      const tmdbId = req.params.tmdbId;
      
      // Get movie details from TMDB
      const movieDetails = await this.getMovieDetailsFromTMDB(tmdbId);
      
      // Get title for better search results
      const title = movieDetails.title || movieDetails.original_title;
      
      console.log(`Processing movie subtitle request for: "${title}" (TMDB ID: ${tmdbId})`);
      
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
      console.log(`Found movie: "${movie.title}" (Rating: ${movie.rating})`);
      
      // Now we need to click on the result and capture the subtitle URL
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Set up request interception
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        
        // Allow all API requests (needed for subtitle requests)
        if (request.url().includes('/wefeed-h5-bff/web/')) {
          request.continue();
        }
        // Block less important resources
        else if (['image', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Set up promise to capture subtitle URL
      const subtitlePromise = this.captureSubtitleUrl(page);
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(45000);
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      console.log(`Navigating to search page: ${searchUrl}`);
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
      
      console.log(`Clicking on movie card: "${cardTitle}" (index ${movie.cardIndex})`);
      
      // Click on the "Watch now" button for this card
      const watchButton = await cards[movie.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      await watchButton.click();
      
      // Wait for navigation to complete
      console.log('Waiting for navigation after card click...');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
      
      console.log(`Navigated to movie page: ${page.url()}`);
      
      // Wait a bit for page to initialize
      await delay(2000); // Using our custom delay function
      
      // Try to interact with the player to trigger subtitle loading
      try {
        const playButtonSelectors = [
          '.vjs-big-play-button', 
          '.play-button',
          '.pc-player-cot .play',
          '[aria-label="Play"]',
          '.player-control-play'
        ];
        
        for (const selector of playButtonSelectors) {
          const playButton = await page.$(selector);
          if (playButton) {
            console.log(`Found play button (${selector}), clicking it...`);
            await playButton.click().catch(() => console.log(`Failed to click ${selector}`));
            break;
          }
        }
      } catch (err) {
        console.log(`Error interacting with player: ${err.message}`);
      }
      
      // Wait for subtitle URL to be captured or timeout
      const subtitleData = await subtitlePromise;
      
      if (!subtitleData) {
        console.log('No subtitle URL captured');
        return res.status(404).json({
          success: false,
          message: 'No subtitles found for this movie',
          movie_info: {
            title: movie.title,
            tmdb_id: tmdbId
          }
        });
      }
      
      // Fetch the actual subtitle data
      console.log('Fetching subtitle data from:', subtitleData.url);
      const response = await axios.get(subtitleData.url, { headers: this.headers });
      
      await page.close();
      
      return res.json({
        success: true,
        movie_info: {
          title: movie.title,
          tmdb_id: tmdbId
        },
        subtitle_url: subtitleData.url,
        subtitle_data: response.data
      });
    } catch (error) {
      console.error(`Error getting movie subtitles from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          const url = await page.url();
          console.error(`Current URL: ${url}`);
          await page.close().catch(() => {});
        } catch (contentError) {
          console.error(`Could not capture page URL: ${contentError.message}`);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie subtitles from MovieBox',
        error: error.message
      });
    }
  }

  /**
   * Get TV episode subtitles by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getTvEpisodeSubtitlesByTmdbId(req, res) {
    let browser, page;
    try {
      const tmdbId = req.params.tmdbId;
      const season = parseInt(req.query.season, 10);
      const episode = parseInt(req.query.episode, 10);
      
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
      console.log(`Processing TV subtitle request for: "${tvDetails.name}" (TMDB ID: ${tmdbId}, Season: ${season}, Episode: ${episode})`);
      
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
      console.log(`Found TV show: "${show.title}" (Rating: ${show.rating})`);
      
      // Now we need to click on the result, select season and episode, and capture subtitle URL
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Set up request interception
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        
        // Allow all API requests (needed for subtitle requests)
        if (request.url().includes('/wefeed-h5-bff/web/')) {
          request.continue();
        }
        // Block less important resources
        else if (['image', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Set up promise to capture subtitle URL
      const subtitlePromise = this.captureSubtitleUrl(page);
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(60000); // Extended timeout
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      console.log(`Navigating to search page: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for search results to load
      await page.waitForSelector('.pc-card', { timeout: 30000 });
      
      // Click on the show card
      const cardSelector = '.pc-card';
      const cards = await page.$$(cardSelector);
      
      if (cards.length <= show.cardIndex) {
        throw new Error(`Card at index ${show.cardIndex} not found, only ${cards.length} cards available`);
      }
      
      // Get actual card title to confirm selection
      const cardTitle = await page.evaluate(el => {
        const titleEl = el.querySelector('.pc-card-title');
        return titleEl ? titleEl.textContent.trim() : 'Unknown';
      }, cards[show.cardIndex]);
      
      console.log(`Clicking on TV show card: "${cardTitle}" (index ${show.cardIndex})`);
      
      // Click on the "Watch now" button for this card
      const watchButton = await cards[show.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      await watchButton.click();
      
      // Wait for navigation to complete
      console.log('Waiting for navigation after card click...');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
      
      console.log(`Navigated to TV show page: ${page.url()}`);
      
      // Wait longer for page to initialize
      await delay(5000); // Increased delay to allow page to fully load
      
      // Try to find season selectors using multiple approaches
      try {
        console.log(`Looking for season ${season} selector...`);
        
        // Take a screenshot to debug the page structure
        const timestamp = new Date().getTime();
        const debugScreenshotPath = `./debug-seasons-${tmdbId}-${timestamp}.png`;
        await page.screenshot({ path: debugScreenshotPath, fullPage: true });
        console.log(`Debug screenshot saved to: ${debugScreenshotPath}`);
        
        // Attempt to check page structure to see if it's a different layout
        const pageStructure = await page.evaluate(() => {
          return {
            hasSeasonBox: !!document.querySelector('.pc-se-box'),
            hasSeasonElement: !!document.querySelector('.pc-se'),
            hasEpisodeContainer: !!document.querySelector('.pc-ep-contain'),
            hasEpisodeElement: !!document.querySelector('.pc-ep'),
            visibleElements: Array.from(document.querySelectorAll('div[class^="pc-"]')).map(el => el.className),
            bodyHTML: document.body.innerHTML.substring(0, 1000) // First 1000 chars of HTML for debugging
          };
        });
        
        console.log('Page structure diagnosis:', JSON.stringify(pageStructure, null, 2));
        
        // Check if the show might have only one season (no season selection needed)
        const hasEpisodeContainerDirectly = await page.$('.pc-ep-contain');
        
        if (hasEpisodeContainerDirectly) {
          console.log('Show appears to have only one season, episodes directly visible');
          // Skip season selection and proceed directly to episode selection
        } else {
          // Try multiple selectors for season container
          const seasonSelectors = ['.pc-se-box', '.seasonsList', '.seasons-container', '[class*="season"]'];
          let seasonContainer = null;
          
          for (const selector of seasonSelectors) {
            console.log(`Trying season container selector: ${selector}`);
            try {
              // Increased timeout for waiting for season selector
              seasonContainer = await page.waitForSelector(selector, { timeout: 30000 }).catch(() => null);
              if (seasonContainer) {
                console.log(`Found season container with selector: ${selector}`);
                break;
              }
            } catch (err) {
              console.log(`Selector ${selector} not found`);
            }
          }
          
          if (!seasonContainer) {
            throw new Error('No season container found on page, check the debug screenshot for page structure');
          }
          
          // Try to find season elements with multiple selectors
          const seasonElementSelectors = ['.pc-se', '.season-item', '[class*="season"]'];
          let seasonElements = [];
          
          for (const selector of seasonElementSelectors) {
            console.log(`Trying season element selector: ${selector}`);
            const elements = await page.$$(selector);
            if (elements.length > 0) {
              console.log(`Found ${elements.length} season elements with selector: ${selector}`);
              seasonElements = elements;
              break;
            }
          }
          
          if (seasonElements.length === 0) {
            throw new Error('No season elements found on page');
          }
          
          console.log(`Found ${seasonElements.length} seasons. Looking for S${season.toString().padStart(2, '0')}`);
          
          // Find correct season with more flexible matching
          let foundSeasonElement = false;
          for (let i = 0; i < seasonElements.length; i++) {
            const seasonText = await page.evaluate(el => el.textContent.trim(), seasonElements[i]);
            console.log(`Season ${i+1} text: "${seasonText}"`);
            
            // More flexible matching for season number
            const seasonMatches = [
              `S${season.toString().padStart(2, '0')}`,    // S01
              `Season ${season}`,                          // Season 1
              `Season ${season.toString().padStart(2, '0')}`, // Season 01
              `${season}`,                                 // 1
              `الموسم ${season}`                           // Arabic "Season 1"
            ];
            
            if (seasonMatches.some(match => seasonText.includes(match))) {
              console.log(`Clicking on season ${season} (matched text: "${seasonText}")`);
              await seasonElements[i].click();
              foundSeasonElement = true;
              break;
            }
          }
          
          if (!foundSeasonElement) {
            // If no exact match, try clicking on the first season element if we're looking for season 1
            if (season === 1 && seasonElements.length > 0) {
              console.log('No exact match for Season 1, trying first season element');
              await seasonElements[0].click();
              foundSeasonElement = true;
            } else {
              throw new Error(`Season ${season} not found on page`);
            }
          }
        }
        
      } catch (seasonError) {
        console.error(`Error selecting season: ${seasonError.message}`);
        
        // Take a screenshot of the error state
        const timestamp = new Date().getTime();
        const errorScreenshotPath = `./error-seasons-${tmdbId}-${timestamp}.png`;
        await page.screenshot({ path: errorScreenshotPath, fullPage: true });
        console.error(`Error screenshot saved to: ${errorScreenshotPath}`);
        
        // Dump the HTML content for debugging
        const htmlContent = await page.content();
        console.error(`HTML content sample: ${htmlContent.substring(0, 500)}...`);
        
        throw new Error(`Failed to select season ${season}: ${seasonError.message}`);
      }
      
      // Wait longer for the episodes to update
      await delay(5000); // Increased delay
      
      // Find and click on the episode with more flexible selectors
      try {
        console.log(`Looking for episode ${episode} selector...`);
        
        // Take a screenshot to debug the episode structure
        const timestamp = new Date().getTime();
        const debugEpScreenshotPath = `./debug-episodes-${tmdbId}-${timestamp}.png`;
        await page.screenshot({ path: debugEpScreenshotPath, fullPage: true });
        console.log(`Debug episode screenshot saved to: ${debugEpScreenshotPath}`);
        
        // Try multiple selectors for episode container
        const episodeContainerSelectors = ['.pc-ep-contain', '.episodes-container', '.episodesList', '[class*="episode"]'];
        let episodeContainer = null;
        
        for (const selector of episodeContainerSelectors) {
          console.log(`Trying episode container selector: ${selector}`);
          try {
            episodeContainer = await page.waitForSelector(selector, { timeout: 30000 }).catch(() => null);
            if (episodeContainer) {
              console.log(`Found episode container with selector: ${selector}`);
              break;
            }
          } catch (err) {
            console.log(`Episode container selector ${selector} not found`);
          }
        }
        
        if (!episodeContainer) {
          throw new Error('No episode container found on page');
        }
        
        // Try multiple selectors for episode elements
        const episodeElementSelectors = ['.pc-ep', '.episode-item', '[class*="episode"]'];
        let episodeElements = [];
        
        for (const selector of episodeElementSelectors) {
          console.log(`Trying episode element selector: ${selector}`);
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            console.log(`Found ${elements.length} episode elements with selector: ${selector}`);
            episodeElements = elements;
            break;
          }
        }
        
        if (episodeElements.length === 0) {
          throw new Error('No episode elements found on page');
        }
        
        console.log(`Found ${episodeElements.length} episodes. Looking for episode ${episode.toString().padStart(2, '0')}`);
        
        // Find correct episode with more flexible matching
        let foundEpisodeElement = false;
        for (let i = 0; i < episodeElements.length; i++) {
          const episodeText = await page.evaluate(el => {
            // Check for span or any text content that might contain episode number
            const span = el.querySelector('span');
            const text = span ? span.textContent.trim() : el.textContent.trim();
            return text;
          }, episodeElements[i]);
          
          console.log(`Episode ${i+1} text: "${episodeText}"`);
          
          // More flexible matching for episode number
          const episodeMatches = [
            `${episode.toString().padStart(2, '0')}`,     // 01
            `E${episode.toString().padStart(2, '0')}`,    // E01
            `Episode ${episode}`,                         // Episode 1
            `${episode}`,                                 // 1
            `الحلقة ${episode}`                           // Arabic "Episode 1"
          ];
          
          if (episodeMatches.some(match => episodeText.includes(match))) {
            console.log(`Clicking on episode ${episode} (matched text: "${episodeText}")`);
            await episodeElements[i].click();
            foundEpisodeElement = true;
            break;
          }
        }
        
        if (!foundEpisodeElement) {
          // If no exact match and we're looking for episode 1, try the first episode
          if (episode === 1 && episodeElements.length > 0) {
            console.log('No exact match for Episode 1, trying first episode element');
            await episodeElements[0].click();
            foundEpisodeElement = true;
          } else {
            throw new Error(`Episode ${episode} not found on page`);
          }
        }
        
      } catch (episodeError) {
        console.error(`Error selecting episode: ${episodeError.message}`);
        
        // Take a screenshot of the error state
        const timestamp = new Date().getTime();
        const errorScreenshotPath = `./error-episodes-${tmdbId}-${timestamp}.png`;
        await page.screenshot({ path: errorScreenshotPath, fullPage: true });
        console.error(`Error screenshot saved to: ${errorScreenshotPath}`);
        
        throw new Error(`Failed to select episode ${episode}: ${episodeError.message}`);
      }
      
      // Wait longer for video player to load after selecting episode
      await delay(5000); // Increased delay
      
      // Try multiple times to interact with the player to trigger subtitle loading
      let playSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          console.log(`Play button click attempt ${attempt + 1}`);
          
          const playButtonSelectors = [
            '.vjs-big-play-button', 
            '.play-button',
            '.pc-player-cot .play',
            '[aria-label="Play"]',
            '.player-control-play',
            '.art-video-player .art-control-button',
            'button.art-control'
          ];
          
          for (const selector of playButtonSelectors) {
            const playButton = await page.$(selector);
            if (playButton) {
              console.log(`Found play button (${selector}), clicking it...`);
              await playButton.click().catch(() => console.log(`Failed to click ${selector}`));
              playSuccess = true;
              break;
            }
          }
          
          if (playSuccess) break;
          
          // If no button found, try clicking on the video element itself
          const videoElement = await page.$('video');
          if (videoElement) {
            console.log('Clicking directly on video element');
            await videoElement.click();
            playSuccess = true;
            break;
          }
          
          // Wait before next attempt
          await delay(2000);
        } catch (err) {
          console.log(`Error in play attempt ${attempt + 1}: ${err.message}`);
        }
      }
      
      // Wait for subtitle URL to be captured or timeout
      const subtitleData = await subtitlePromise;
      
      if (!subtitleData) {
        console.log('No subtitle URL captured');
        
        // Take a screenshot to help debug why subtitles weren't found
        const timestamp = new Date().getTime();
        const finalScreenshotPath = `./no-subtitles-${tmdbId}-${timestamp}.png`;
        await page.screenshot({ path: finalScreenshotPath, fullPage: true });
        console.log(`Final screenshot saved to: ${finalScreenshotPath}`);
        
        return res.status(404).json({
          success: false,
          message: 'No subtitles found for this episode',
          episode_info: {
            show_title: show.title,
            tmdb_id: tmdbId,
            season: season,
            episode: episode
          }
        });
      }
      
      // Fetch the actual subtitle data
      console.log('Fetching subtitle data from:', subtitleData.url);
      const response = await axios.get(subtitleData.url, { headers: this.headers });
      
      await page.close();
      
      // Cache the successful response
      const responseData = {
        success: true,
        episode_info: {
          show_title: show.title,
          tmdb_id: tmdbId,
          season: season,
          episode: episode
        },
        subtitle_url: subtitleData.url,
        subtitle_data: response.data
      };
      
      movieboxCache.set(cacheKey, responseData, 7200); // Cache for 2 hours
      return res.json(responseData);
    } catch (error) {
      console.error(`Error getting TV episode subtitles from MovieBox: ${error.message}`);
      
      if (page) {
        try {
          const url = await page.url();
          console.error(`Current URL: ${url}`);
          
          // Take a final error screenshot
          const timestamp = new Date().getTime();
          const finalErrorPath = `./final-error-${tmdbId}-${timestamp}.png`;
          await page.screenshot({ path: finalErrorPath, fullPage: true });
          console.error(`Final error screenshot saved to: ${finalErrorPath}`);
          
          await page.close().catch(() => {});
        } catch (contentError) {
          console.error(`Could not capture page URL: ${contentError.message}`);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get TV episode subtitles from MovieBox',
        error: error.message,
        error_details: {
          request_params: {
            tmdb_id: req.params.tmdbId,
            season: req.query.season,
            episode: req.query.episode
          }
        }
      });
    }
  }

  // Add cache cleanup method
  async clearCache() {
    movieboxCache.flushAll();
    console.log('MovieBox cache cleared');
  }
}

export const movieboxController = new MovieBoxController(); 