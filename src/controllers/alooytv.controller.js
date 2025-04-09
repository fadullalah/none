import axios from 'axios';
import { JSDOM } from 'jsdom';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import NodeCache from 'node-cache';
import { bunnyStreamController } from './bunny.controller.js';
import { screenshotUtility } from '../utils/screenshot.utility.js';

// Register stealth plugin to avoid detection
puppeteerExtra.use(StealthPlugin());

// Cache with 3 hour TTL
const alootvCache = new NodeCache({ stdTTL: 10800 });

// Browser pool management
let browserInstance = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 300000; // 5 minutes

class AlooTVController {
  constructor() {
    this.gatewayUrl = 'https://fitnur.com/alooytv';
    this.tmdbApiKey = process.env.API_TOKEN;
    this.tmdbApiBaseUrl = 'https://api.themoviedb.org/3';
    
    // Enhanced headers to appear as a regular browser coming from Google
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
    console.log('Rotated user agent to:', randomAgent);
  }

  /**
   * Get or create a browser instance
   * @returns {Promise<Browser>} Puppeteer browser instance
   */
  async getBrowser() {
    if (!browserInstance) {
      console.log('Creating new browser instance');
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
    try {
      const url = `${this.tmdbApiBaseUrl}/movie/${tmdbId}?api_key=${this.tmdbApiKey}&language=ar`;
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
      const url = `${this.tmdbApiBaseUrl}/tv/${tmdbId}?api_key=${this.tmdbApiKey}&language=ar`;
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
   * Take a screenshot and upload it to Imgur
   * @param {Object} page - Puppeteer page object
   * @param {string} name - Screenshot name/description
   * @returns {Promise<string|null>} - URL of the uploaded image
   */
  async captureScreenshot(page, name) {
    const screenshot = await screenshotUtility.captureScreenshot(page, name, true);
    return screenshot?.url || null;
  }

  /**
   * Get movie by TMDB ID with screenshots
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getMovieByTmdbId(req, res) {
    let browser, page;
    // Array to store screenshot URLs
    const screenshots = [];
    
    try {
      const tmdbId = req.params.tmdbId;
      
      // Get movie details from TMDB
      const movieDetails = await this.getMovieDetailsFromTMDB(tmdbId);
      
      // Get Arabic title for better search results
      const arabicTitle = movieDetails.title || movieDetails.original_title;
      
      // Search for the movie on AlooTV
      const searchResults = await this.search(arabicTitle);
      
      if (searchResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Movie not found on AlooTV',
          error_details: {
            search_query: arabicTitle,
            tmdb_id: tmdbId,
            type: 'movie',
            timestamp: new Date().toISOString()
          }
        });
      }
      
      // Get the first result (most relevant)
      const movie = searchResults[0];
      
      // Add browser-based screenshots
      browser = await this.getBrowser();
      page = await browser.newPage();
      await this.applyEnhancedPageHeaders(page);
      
      // Navigate to search page
      const domain = await this.discoverCurrentDomain();
      await page.goto(`${domain}/search?q=${encodeURIComponent(arabicTitle)}`, { waitUntil: 'domcontentloaded' });
      
      // Capture search results screenshot
      const searchScreenshotUrl = await this.captureScreenshot(page, `alootv-search-${tmdbId}`);
      if (searchScreenshotUrl) screenshots.push({ step: 'search_results', url: searchScreenshotUrl });
      
      // Navigate to movie page
      await page.goto(movie.link, { waitUntil: 'domcontentloaded' });
      
      // Capture movie page screenshot
      const detailScreenshotUrl = await this.captureScreenshot(page, `alootv-movie-${tmdbId}`);
      if (detailScreenshotUrl) screenshots.push({ step: 'movie_details', url: detailScreenshotUrl });
      
      // Get player URL for the movie
      const playerUrl = await this.getEpisodePlayerUrl(movie.link);
      
      // Upload to Bunny Stream in the background
      bunnyStreamController.uploadVideoToCollection(playerUrl, {
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
        player_url: playerUrl,
        screenshots: screenshots
      });
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      const errorMessage = error.message || 'Unknown error';
      const errorStack = error.stack || '';
      
      console.error(`Error getting movie from AlooTV: ${errorMessage}, Status: ${statusCode}, Code: ${errorCode}`);
      console.error(errorStack);
      
      // Capture error screenshot if page exists
      if (page) {
        const errorScreenshotUrl = await this.captureScreenshot(page, `alootv-error-${req.params.tmdbId}`);
        if (errorScreenshotUrl) screenshots.push({ step: 'error', url: errorScreenshotUrl });
        await page.close().catch(() => {});
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie from AlooTV',
        error: errorMessage,
        status_code: statusCode,
        error_code: errorCode,
        error_stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
        screenshots: screenshots
      });
    }
  }

  /**
   * Get TV episode by TMDB ID with screenshots
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getTvEpisodeByTmdbId(req, res) {
    // Similar implementation with screenshots
    // ... (update the existing method to use screenshotUtility)
  }

  /**
   * Enhanced search that tries multiple search strategies
   * @param {Object} tvDetails - TV show details from TMDB
   * @returns {Promise<Array>} - Search results
   */
  async enhancedSearch(tvDetails) {
    const arabicTitle = tvDetails.name || tvDetails.original_name;
    const originalTitle = tvDetails.original_name;
    const allSearchAttempts = [];
    let searchResults = [];
    
    console.log(`Starting enhanced search for: "${arabicTitle}" (Original: "${originalTitle}")`);
    
    // Strategy 1: Try the full Arabic title first
    try {
      searchResults = await this.search(arabicTitle);
      console.log(`Strategy 1 (Full Arabic title): Found ${searchResults.length} results`);
      allSearchAttempts.push({ query: arabicTitle, results: searchResults.length });
      
      if (searchResults.length > 0) {
        return searchResults;
      }
    } catch (error) {
      console.error(`Error in strategy 1: ${error.message}`);
    }
    
    // Strategy 2: Try the original title
    if (originalTitle && originalTitle !== arabicTitle) {
      try {
        searchResults = await this.search(originalTitle);
        console.log(`Strategy 2 (Original title): Found ${searchResults.length} results`);
        allSearchAttempts.push({ query: originalTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 2: ${error.message}`);
      }
    }
    
    // Strategy 3: Try main part of the title (before any colon or dash)
    const mainTitleMatch = arabicTitle.match(/^([^:—–-]+)/);
    if (mainTitleMatch && mainTitleMatch[1].trim() !== arabicTitle) {
      const mainTitle = mainTitleMatch[1].trim();
      try {
        searchResults = await this.search(mainTitle);
        console.log(`Strategy 3 (Main part of title): "${mainTitle}" found ${searchResults.length} results`);
        allSearchAttempts.push({ query: mainTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 3: ${error.message}`);
      }
    }
    
    // Strategy 4: Try with the first few words of the title
    const words = arabicTitle.split(' ');
    if (words.length > 2) {
      const shortTitle = words.slice(0, 3).join(' '); // First 3 words
      try {
        searchResults = await this.search(shortTitle);
        console.log(`Strategy 4 (First few words): "${shortTitle}" found ${searchResults.length} results`);
        allSearchAttempts.push({ query: shortTitle, results: searchResults.length });
        
        if (searchResults.length > 0) {
          return searchResults;
        }
      } catch (error) {
        console.error(`Error in strategy 4: ${error.message}`);
      }
    }
    
    // Strategy 5: Try with key character names or distinctive words
    const keyParts = arabicTitle.split(/[:\s—–-]+/).filter(part => part.length > 3);
    for (let i = 0; i < keyParts.length && i < 2; i++) {
      try {
        searchResults = await this.search(keyParts[i]);
        console.log(`Strategy 5 (Key word ${i+1}): "${keyParts[i]}" found ${searchResults.length} results`);
        allSearchAttempts.push({ query: keyParts[i], results: searchResults.length });
        
        if (searchResults.length > 0) {
          // Filter results to make sure they're relevant to our original query
          const filteredResults = this.filterRelevantResults(searchResults, arabicTitle, originalTitle);
          if (filteredResults.length > 0) {
            console.log(`Found ${filteredResults.length} relevant results after filtering`);
            return filteredResults;
          }
        }
      } catch (error) {
        console.error(`Error in strategy 5 part ${i+1}: ${error.message}`);
      }
    }
    
    console.log('All search strategies exhausted. Search attempts:', allSearchAttempts);
    return [];
  }
  
  /**
   * Filter search results to ensure they're relevant to the original query
   * @param {Array} results - Search results
   * @param {string} arabicTitle - Arabic title
   * @param {string} originalTitle - Original title
   * @returns {Array} - Filtered results
   */
  filterRelevantResults(results, arabicTitle, originalTitle) {
    // When using partial search terms, we need to ensure results are relevant
    if (!results || results.length === 0) return [];
    
    // Convert titles to lowercase for comparison
    const arabicTitleLower = arabicTitle.toLowerCase();
    const originalTitleLower = originalTitle ? originalTitle.toLowerCase() : '';
    
    // For each result, calculate a relevance score
    const scoredResults = results.map(result => {
      const title = result.title.toLowerCase();
      let score = 0;
      
      // Check if the result title contains parts of our search query
      if (title.includes(arabicTitleLower) || arabicTitleLower.includes(title)) {
        score += 3;
      }
      
      if (originalTitleLower && (title.includes(originalTitleLower) || originalTitleLower.includes(title))) {
        score += 2;
      }
      
      // Split titles into words and check for word overlap
      const resultWords = title.split(/\s+/);
      const arabicWords = arabicTitleLower.split(/\s+/);
      
      // Count matching words
      for (const word of arabicWords) {
        if (word.length > 2 && resultWords.includes(word)) {
          score += 1;
        }
      }
      
      return { ...result, relevanceScore: score };
    });
    
    // Filter results with at least some relevance and sort by score
    const relevantResults = scoredResults
      .filter(result => result.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    return relevantResults;
  }

  /**
   * Discover the current domain by using the domain worker
   * @returns {Promise<string>} Current domain for AlooTV
   */
  async discoverCurrentDomain() {
    const cacheKey = 'alootv_current_domain';
    const cachedDomain = alootvCache.get(cacheKey);
    
    if (cachedDomain) {
      return cachedDomain;
    }
    
    // Increased timeout from 5 seconds to 15 seconds
    const timeoutMs = 15000;
    // Add retry attempts
    const maxRetries = 3;
    let lastError = null;
    
    // Try multiple times with increasing timeouts
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Fetching AlooTV domain from worker (attempt ${attempt}/${maxRetries})...`);
        
        const response = await axios.get('https://domain.nunflix-info.workers.dev/', {
          timeout: timeoutMs * attempt, // Increase timeout with each retry
          headers: this.headers
        });
        
        const domain = response.data.trim();
        
        if (!domain) {
          throw new Error('Empty domain returned from worker');
        }
        
        console.log('Found domain:', domain);
        
        // Format the domain with https protocol
        const formattedDomain = `https://${domain}`;
        
        // Cache the domain for longer to reduce API calls
        alootvCache.set(cacheKey, formattedDomain, 12 * 3600); // Cache for 12 hours
        
        return formattedDomain;
      } catch (error) {
        const statusCode = error.response?.status || 'No status code';
        const errorCode = error.code || 'No error code';
        
        console.error(`Error discovering AlooTV domain (attempt ${attempt}/${maxRetries}): ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
        
        lastError = error;
        
        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const waitTime = 1000 * attempt; // Progressively longer waits
          console.log(`Waiting ${waitTime}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // Fallback to hardcoded domains if all attempts fail
    console.log('All domain discovery attempts failed, using fallback domains...');
    const fallbackDomains = [
      'https://a4500sdf.9alooytv.shop',
      'https://4500sd.alooytv.today',
      'https://a4500sd.alooytv.online'
    ];
    
    // Try each fallback domain
    for (const fallbackDomain of fallbackDomains) {
      try {
        console.log(`Testing fallback domain: ${fallbackDomain}`);
        const testResponse = await axios.get(`${fallbackDomain}/search?q=test`, {
          timeout: timeoutMs,
          headers: this.headers
        });
        
        if (testResponse.status === 200) {
          console.log(`Fallback domain ${fallbackDomain} is working`);
          alootvCache.set(cacheKey, fallbackDomain, 6 * 3600); // Cache for 6 hours (shorter than normal)
          return fallbackDomain;
        }
      } catch (fallbackError) {
        console.error(`Fallback domain ${fallbackDomain} is not working:`, fallbackError.message);
      }
    }
    
    // If we've gotten here, throw the original error
    throw lastError || new Error('Failed to discover AlooTV domain after multiple attempts');
  }

  /**
   * Search for shows on AlooTV
   * @param {string} query - Search query
   * @returns {Promise<Array>} - List of shows matching the query
   */
  async search(query) {
    const cacheKey = `alootv_search_${query}`;
    
    const cachedResults = alootvCache.get(cacheKey);
    if (cachedResults) {
      return cachedResults;
    }
    
    let domain;
    try {
      domain = await this.discoverCurrentDomain();
    } catch (domainError) {
      const statusCode = domainError.response?.status || 'No status code';
      const errorCode = domainError.code || 'No error code';
      console.error(`Failed to get domain: ${domainError.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw new Error(`Domain discovery failed: ${domainError.message}, Status: ${statusCode}, Code: ${errorCode}`);
    }
    
    const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}`;
    console.log(`Searching AlooTV: ${searchUrl}`);
    
    let browser, page;
    try {
      browser = await this.getBrowser();
      page = await browser.newPage();
      
      // Optimize page for speed
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // Block unnecessary resources
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Apply enhanced headers for better anonymity
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(20000);
      
      console.log(`Navigating to: ${searchUrl}`);
      
      // Navigate to search page with faster load strategy
      const response = await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 20000 
      });
      
      if (!response.ok()) {
        const status = response.status();
        throw new Error(`Search page returned status ${status} (${response.statusText()})`);
      }
      
      // Extract search results
      const searchResults = await page.evaluate(() => {
        const shows = [];
        const movieContainers = document.querySelectorAll('.movie-container .col-md-2');
        
        if (movieContainers.length === 0) {
          // Log detailed page structure for debugging if no results found
          const pageContent = document.body.innerHTML;
          console.log('Page content:', pageContent.substring(0, 500) + '...');
        }
        
        movieContainers.forEach(container => {
          const titleElement = container.querySelector('.movie-title h3 a');
          const linkElement = container.querySelector('a.ico-play');
          
          if (titleElement && linkElement) {
            const title = titleElement.textContent.trim();
            const link = linkElement.href;
            const image = container.querySelector('img.img-responsive')?.src || '';
            const episodesText = container.querySelector('.video_quality span')?.textContent.trim() || '';
            const episodesMatch = episodesText.match(/(\d+)/);
            const episodeCount = episodesMatch ? parseInt(episodesMatch[1]) : 0;
            
            shows.push({
              title,
              link,
              image,
              episodeCount
            });
          }
        });
        
        return shows;
      });
      
      // Cache results
      alootvCache.set(cacheKey, searchResults, 21600); // Cache for 6 hours
      
      await page.close(); // Close page but keep browser
      return searchResults;
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      
      // Capture page content on error if page is available
      let pageContent = 'Not available';
      if (page) {
        try {
          pageContent = await page.content();
          pageContent = pageContent.substring(0, 500) + '...'; // Trim for log
        } catch (contentError) {
          pageContent = 'Failed to capture: ' + contentError.message;
        }
      }
      
      console.error(`Error searching AlooTV (${searchUrl}): ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      console.error(`Page content sample: ${pageContent}`);
      
      if (page) await page.close().catch(() => {});
      
      throw new Error(`Search failed for "${query}": ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
    }
  }

  /**
   * Get details of a show including all seasons and episodes
   * @param {string} url - URL of the show page
   * @returns {Promise<Object>} - Show details with seasons and episodes
   */
  async getShowDetails(url) {
    const cacheKey = `alootv_show_${url}`;
    
    const cachedDetails = alootvCache.get(cacheKey);
    if (cachedDetails) {
      return cachedDetails;
    }
    
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
      // Optimize page loading
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(20000);
      
      // Navigate to show page with faster load strategy
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 20000 
      });
      
      // Extract show details and episodes - using fast, targeted selectors
      const showDetails = await page.evaluate(() => {
        const title = document.querySelector('h1.movie-title')?.textContent.trim() || 
                     document.querySelector('.movie-title h1')?.textContent.trim() || 
                     document.querySelector('h1')?.textContent.trim() || '';
        const image = document.querySelector('.img-responsive')?.src || '';
        const description = document.querySelector('.synopsis')?.textContent.trim() || '';
        
        const seasons = [];
        const seasonElements = document.querySelectorAll('.season');
        
        if (seasonElements.length > 0) {
          seasonElements.forEach(seasonElement => {
            const seasonHeading = seasonElement.querySelector('.movie-heading span')?.textContent.trim();
            const seasonMatches = seasonHeading?.match(/S\s*(\d+)/i) || 
                                seasonHeading?.match(/الموسم\s*(\d+)/i) ||
                                seasonHeading?.match(/(\d+)/) || ['', '1'];
            const seasonNumber = seasonMatches[1] || '1';
            
            const episodes = [];
            const episodeLinks = seasonElement.querySelectorAll('a.btn-ep');
            
            episodeLinks.forEach(link => {
              const episodeText = link.textContent.trim();
              const episodeMatches = episodeText.match(/Ep#(\d+)/i) || 
                                  episodeText.match(/الحلقة\s*(\d+)/i) ||
                                  episodeText.match(/(\d+)/);
              const episodeNumber = episodeMatches?.[1] || '';
              const episodeUrl = link.href;
              
              if (episodeNumber) {
                episodes.push({
                  number: parseInt(episodeNumber),
                  url: episodeUrl
                });
              }
            });
            
            // Sort episodes by number
            episodes.sort((a, b) => a.number - b.number);
            
            if (episodes.length > 0) {
              seasons.push({
                number: parseInt(seasonNumber),
                episodes
              });
            } else {
              // Fallback - add season with one episode pointing to show page
              seasons.push({
                number: parseInt(seasonNumber),
                episodes: [{
                  number: 1,
                  url: window.location.href
                }]
              });
            }
          });
        } else {
          // No seasons found - create default season
          seasons.push({
            number: 1,
            episodes: [{
              number: 1,
              url: window.location.href
            }]
          });
        }
        
        // Sort seasons by number
        seasons.sort((a, b) => a.number - b.number);
        
        return {
          title,
          image,
          description,
          seasons
        };
      });
      
      // Cache results
      alootvCache.set(cacheKey, showDetails, 21600); // Cache for 6 hours
      
      await page.close(); // Close page but keep browser
      return showDetails;
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error getting AlooTV show details: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw error;
    }
  }

  /**
   * Get the direct video URL from an episode page
   * @param {string} episodeUrl - URL of the episode
   * @returns {Promise<string>} - Direct video URL
   */
  async getEpisodePlayerUrl(episodeUrl) {
    const cacheKey = `alootv_player_${episodeUrl}`;
    
    const cachedUrl = alootvCache.get(cacheKey);
    if (cachedUrl) {
      console.log(`Using cached video URL for ${episodeUrl}`);
      return cachedUrl;
    }
    
    console.log(`Extracting video from: ${episodeUrl}`);
    
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
      await this.applyEnhancedPageHeaders(page);
      await page.setDefaultNavigationTimeout(30000);
      
      // Only track video-related requests to reduce overhead
      let videoUrls = [];
      await page.setRequestInterception(true);
      
      page.on('request', request => {
        const url = request.url();
        const resourceType = request.resourceType();
        
        // Only track potential video resources
        if ((url.endsWith('.mp4') || url.includes('.mp4?') || 
             url.endsWith('.m3u8') || url.includes('.m3u8?'))) {
          videoUrls.push(url);
        }
        
        // Skip less important resources
        if (['image', 'font', 'stylesheet'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Navigate to episode page with optimized loading strategy
      console.log(`Loading page ${episodeUrl}`);
      await page.goto(episodeUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      // Look for video and source elements using optimized query
      const videoUrl = await page.evaluate(() => {
        // Optimized DOM query - avoid multiple querySelectorAll calls
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          if (video.src) return video.src;
          
          const source = video.querySelector('source[src]');
          if (source) return source.src;
        }
        
        // Check for video sources outside video elements
        const sources = document.querySelectorAll('source[src]');
        for (const source of sources) {
          if (source.src) return source.src;
        }
        
        return null;
      });
      
      let finalVideoUrl = videoUrl;
      
      // If no video found in DOM, use the ones captured from network
      if (!finalVideoUrl && videoUrls.length > 0) {
        // Prefer MP4 over M3U8
        const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
        finalVideoUrl = mp4Urls.length > 0 ? mp4Urls[0] : videoUrls[0];
      }
      
      // Fall back to page URL if necessary
      if (!finalVideoUrl) {
        finalVideoUrl = page.url();
      }
      
      // Cache the URL
      alootvCache.set(cacheKey, finalVideoUrl, 3600); // Cache for 1 hour
      
      await page.close(); // Close page but keep browser
      return finalVideoUrl;
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error extracting video URL: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      console.error(error.stack);
      throw error;
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

export const alootvController = new AlooTVController(); 