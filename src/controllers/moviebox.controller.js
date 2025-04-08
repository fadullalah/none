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
  }

  /**
   * Get or create a browser instance
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
            '--disable-infobars',
            '--disable-dev-shm-usage',  // Add to avoid crash in containerized environments
            '--no-zygote'  // Add to improve stability
          ],
          ignoreDefaultArgs: ['--enable-automation'] // Hide automation
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
   * Select the highest video quality available
   * @param {Object} page - Puppeteer page
   * @returns {Promise<void>}
   */
  async selectHighestQuality(page) {
    try {
      // Check if quality selector exists
      const qualitySelector = await page.$('.art-control-quality');
      if (!qualitySelector) {
        return;
      }
      
      // Click on the quality selector to open the dropdown
      await qualitySelector.click();
      
      // Wait for the quality options to appear
      await delay(1000);
      
      // Find all quality options
      const qualityOptions = await page.$$('.art-selector-item');
      
      if (!qualityOptions || qualityOptions.length === 0) {
        return;
      }
      
      // Get the quality values/labels
      const qualities = await Promise.all(qualityOptions.map(async (option) => {
        const text = await page.evaluate(el => el.textContent.trim(), option);
        return {
          element: option,
          text: text,
          value: text.toLowerCase() // Convert to lowercase for easier comparison
        };
      }));
      
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
      
      // Click on the highest quality option
      await highestQuality.element.click();
      
      // Wait for video to adjust to new quality
      await delay(2000);
    } catch (error) {
      // Continue execution even if quality selection fails
    }
  }

  /**
   * Get video URL from a movie or episode page
   * @param {Object} page - Puppeteer page
   * @returns {Promise<string>} - Direct video URL
   */
  async getVideoUrl(page) {
    try {
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
          videoUrls.push(url);
        }
      });
      
      // Wait for the player to initialize
      await delay(3000);
      
      // First try: Check specifically for .art-video element (from the example)
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
      
      await delay(2000);
      
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
      if (videoUrls.length > 0) {
        // Prefer .mp4 over other formats
        const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
        if (mp4Urls.length > 0) {
          console.log('Found MP4 URL from network requests:', mp4Urls[0]);
          return mp4Urls[0];
        }
        
        console.log('Found video URL from network requests:', videoUrls[0]);
        return videoUrls[0];
      }
      
      // Take a screenshot for debugging
      const screenshotPath = `./video-player-debug-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      throw new Error('No video URL found on page');
    } catch (error) {
      console.error(`Error extracting video URL: ${error.message}`);
      throw error;
    }
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
      
      // Click on the "Watch now" button for this card
      const watchButton = await cards[movie.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      await watchButton.click();
      
      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait a bit for page to initialize
      await delay(2000);
      
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
      await page.setDefaultNavigationTimeout(45000);
      
      // Navigate to search page
      const searchUrl = `${this.searchUrl}?keyword=${encodeURIComponent(title)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait for search results to load
      await page.waitForSelector('.pc-card', { timeout: 20000 });
      
      // Click on the show card
      const cardSelector = '.pc-card';
      const cards = await page.$$(cardSelector);
      
      if (cards.length <= show.cardIndex) {
        throw new Error(`Card at index ${show.cardIndex} not found, only ${cards.length} cards available`);
      }
      
      // Click on the "Watch now" button for this card
      const watchButton = await cards[show.cardIndex].$('.pc-card-btn');
      if (!watchButton) {
        throw new Error('Watch button not found');
      }
      
      await watchButton.click();
      
      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
      
      // Wait a bit for page to initialize
      await delay(2000);
      
      // Add this after clicking the show card:
      console.log(`Clicked on search result: ${show.title}`);
      
      // After navigation completes:
      console.log('Navigation completed, waiting for page to stabilize');
      
      // Wait a moment for the episodes to update
      await delay(2000);
      
      // Find and click on the episode
      try {
        // Wait for the episode container
        await page.waitForSelector('.pc-ep-contain', { timeout: 15000 });
        
        // Check if episode elements exist
        const episodeElements = await page.$$('.pc-ep');
        
        if (episodeElements.length === 0) {
          throw new Error('No episodes found on page');
        }
        
        // Find correct episode
        let foundEpisodeElement = false;
        for (let i = 0; i < episodeElements.length; i++) {
          const episodeText = await page.evaluate(el => {
            const span = el.querySelector('span');
            return span ? span.textContent.trim() : '';
          }, episodeElements[i]);
          
          if (episodeText === episode.toString().padStart(2, '0')) {
            await episodeElements[i].click();
            foundEpisodeElement = true;
            break;
          }
        }
        
        if (!foundEpisodeElement) {
          throw new Error(`Episode ${episode} not found on page`);
        }
        
      } catch (episodeError) {
        throw new Error(`Failed to select episode ${episode}: ${episodeError.message}`);
      }
      
      // Wait for video player to load after selecting episode
      await delay(3000);
      
      // Get video URL
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
}

export const movieboxController = new MovieBoxController(); 