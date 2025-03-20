import axios from 'axios';
import { JSDOM } from 'jsdom';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import NodeCache from 'node-cache';

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
   * Get movie by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getMovieByTmdbId(req, res) {
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
          message: 'Movie not found on AlooTV'
        });
      }
      
      // Get the first result (most relevant)
      const movie = searchResults[0];
      
      // Get player URL for the movie
      const playerUrl = await this.getEpisodePlayerUrl(movie.link);
      
      return res.json({
        success: true,
        title: movie.title,
        poster: movie.image,
        player_url: playerUrl
      });
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error getting movie from AlooTV: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie from AlooTV',
        error: error.message,
        status_code: statusCode,
        error_code: errorCode
      });
    }
  }

  /**
   * Get TV episode by TMDB ID
   * @param {*} req - Express request object
   * @param {*} res - Express response object
   */
  async getTvEpisodeByTmdbId(req, res) {
    try {
      const tmdbId = req.params.tmdbId;
      const season = parseInt(req.query.season, 10);
      const episode = parseInt(req.query.episode, 10);
      
      if (isNaN(season) || isNaN(episode)) {
        return res.status(400).json({
          success: false,
          message: 'Season and episode numbers are required'
        });
      }
      
      // Get TV details from TMDB
      const tvDetails = await this.getTVDetailsFromTMDB(tmdbId);
      
      // Get Arabic title for better search results
      const arabicTitle = tvDetails.name || tvDetails.original_name;
      
      // Search for the TV show on AlooTV
      const searchResults = await this.search(arabicTitle);
      
      if (searchResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'TV show not found on AlooTV'
        });
      }
      
      // Get the first result (most relevant)
      const show = searchResults[0];
      
      // Get show details including seasons and episodes
      const showDetails = await this.getShowDetails(show.link);
      
      // Find the requested season
      const targetSeason = showDetails.seasons.find(s => s.number === season);
      
      if (!targetSeason) {
        return res.status(404).json({
          success: false,
          message: `Season ${season} not found`
        });
      }
      
      // Find the requested episode
      const targetEpisode = targetSeason.episodes.find(e => e.number === episode);
      
      if (!targetEpisode) {
        return res.status(404).json({
          success: false,
          message: `Episode ${episode} not found in season ${season}`
        });
      }
      
      // Get player URL for the episode
      const playerUrl = await this.getEpisodePlayerUrl(targetEpisode.url);
      
      return res.json({
        success: true,
        title: `${showDetails.title} - S${season}E${episode}`,
        poster: showDetails.image,
        player_url: playerUrl
      });
    } catch (error) {
      const statusCode = error.response?.status || 'No status code';
      const errorCode = error.code || 'No error code';
      console.error(`Error getting TV episode from AlooTV: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to get TV episode from AlooTV',
        error: error.message,
        status_code: statusCode,
        error_code: errorCode
      });
    }
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
    
    try {
      console.log('Fetching AlooTV domain from worker...');
      const response = await axios.get('https://domain.nunflix-info.workers.dev/', {
        timeout: 5000,
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
      console.error(`Error discovering AlooTV domain: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw error;
    }
  }

  /**
   * Search for shows on AlooTV
   * @param {string} query - Search query
   * @returns {Promise<Array>} - List of shows matching the query
   */
  async search(query) {
    const domain = await this.discoverCurrentDomain();
    const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}`;
    const cacheKey = `alootv_search_${query}`;
    
    const cachedResults = alootvCache.get(cacheKey);
    if (cachedResults) {
      return cachedResults;
    }
    
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
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
      
      // Navigate to search page with faster load strategy
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 20000 
      });
      
      // Extract search results
      const searchResults = await page.evaluate(() => {
        const shows = [];
        const movieContainers = document.querySelectorAll('.movie-container .col-md-2');
        
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
      console.error(`Error searching AlooTV: ${error.message}, Status: ${statusCode}, Code: ${errorCode}`);
      throw error;
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