import axios from 'axios';
import { JSDOM } from 'jsdom';
import NodeCache from 'node-cache';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Register the stealth plugin
puppeteerExtra.use(StealthPlugin());

// Cache with 3 hour TTL
const faselhdCache = new NodeCache({ stdTTL: 10800 });

class FaselHDController {
  constructor() {
    this.baseUrl = 'https://www.faselhds.care';
    this.tmdbApiKey = process.env.API_TOKEN;
    this.tmdbApiBaseUrl = 'https://api.themoviedb.org/3';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      'Cookie': 'fcuid=6a5935fc9d86eee313dba99b2d118b6d3dc808e0'
    };
  }

  /**
   * Get movie details from TMDB API
   * @param {string} tmdbId - TMDB ID of the movie
   * @returns {Promise<Object>} - Movie details
   */
  async getMovieDetailsFromTMDB(tmdbId) {
    try {
      const url = `${this.tmdbApiBaseUrl}/movie/${tmdbId}?api_key=${this.tmdbApiKey}&language=en-US`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching movie details from TMDB: ${error.message}`);
      throw new Error(`TMDB API error: ${error.message}`);
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
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching TV details from TMDB: ${error.message}`);
      throw new Error(`TMDB API error: ${error.message}`);
    }
  }

  /**
   * Search for content on FaselHD
   * @param {string} query - Search query
   * @returns {Promise<Array>} - Array of search results
   */
  async searchOnFaselHD(query) {
    try {
      const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        headers: this.headers,
        timeout: 10000
      });
      
      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      
      // Parse search results from the page
      const results = [];
      const resultItems = document.querySelectorAll('#postList .postDiv');
      
      for (const item of resultItems) {
        const linkElement = item.querySelector('a');
        if (!linkElement) continue;
        
        const url = linkElement.getAttribute('href');
        const titleElement = item.querySelector('.h1');
        const title = titleElement ? titleElement.textContent.trim() : '';
        
        // Extract whether it's a movie or series from URL and title
        const isMovie = url.includes('/movie-') || title.includes('فيلم');
        const isSeries = url.includes('/series-') || title.includes('مسلسل');
        
        const type = isMovie ? 'movie' : (isSeries ? 'tv' : 'unknown');
        
        results.push({
          title,
          url,
          type
        });
      }
      
      return results;
    } catch (error) {
      console.error(`Error searching on FaselHD: ${error.message}`);
      throw new Error(`FaselHD search failed: ${error.message}`);
    }
  }

  /**
   * Find the best match from search results
   * @param {Array} results - Search results
   * @param {string} title - Original title
   * @param {string} type - Content type (movie or tv)
   * @returns {Object|null} - Best matching result
   */
  findBestMatch(results, title, type) {
    if (!results || results.length === 0) return null;
    
    // Convert title to lowercase for comparison
    const normalizedTitle = title.toLowerCase().replace(/[^\w\s]/g, '');
    
    // Filter results by type
    const typedResults = results.filter(result => result.type === type);
    
    if (typedResults.length === 0) return null;
    
    // Find exact matches first
    for (const result of typedResults) {
      const resultTitle = result.title.toLowerCase();
      // Check if result contains the original title
      if (resultTitle.includes(normalizedTitle)) {
        return result;
      }
    }
    
    // If no exact match, return the first result of the correct type
    return typedResults[0];
  }

  /**
   * Extract season and episode URLs from series page
   * @param {string} seriesUrl - URL of the series page
   * @param {number} season - Season number
   * @param {number} episode - Episode number
   * @returns {Promise<string|null>} - URL of the episode page
   */
  async getEpisodeUrl(seriesUrl, season, episode) {
    try {
      // Get series page
      const response = await axios.get(seriesUrl, {
        headers: this.headers,
        timeout: 10000
      });
      
      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      
      // Find the season element
      const seasonDivs = document.querySelectorAll('.seasonDiv');
      let seasonUrl = null;
      
      for (const div of seasonDivs) {
        const titleElement = div.querySelector('.title');
        if (!titleElement) continue;
        
        const titleText = titleElement.textContent.trim();
        
        // Check for Arabic or English season titles
        const arabicMatch = titleText.match(/موسم (\d+)/);
        const englishMatch = titleText.match(/Season (\d+)/i) || titleText.match(/S(\d+)/i);
        
        const matchedSeason = arabicMatch ? parseInt(arabicMatch[1]) : 
                            (englishMatch ? parseInt(englishMatch[1]) : null);
        
        if (matchedSeason === parseInt(season)) {
          // Extract the page ID from onclick attribute
          const onclickAttr = div.getAttribute('onclick');
          if (onclickAttr) {
            const urlMatch = onclickAttr.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (urlMatch && urlMatch[1]) {
              if (urlMatch[1].startsWith('/?p=')) {
                const seasonPageId = urlMatch[1].replace('/?p=', '');
                seasonUrl = `${this.baseUrl}/?p=${seasonPageId}`;
              } else {
                seasonUrl = urlMatch[1].startsWith('http') ? urlMatch[1] : `${this.baseUrl}${urlMatch[1]}`;
              }
              break;
            }
          }
          
          // If we couldn't get the URL from onclick, try looking for active class
          if (div.classList.contains('active')) {
            // If this season is active, we're already on the right page
            seasonUrl = seriesUrl;
            break;
          }
        }
      }
      
      // If we didn't find the season URL but found links with season numbers in href attributes
      if (!seasonUrl) {
        const seasonLinks = document.querySelectorAll('a[href*="season"]');
        for (const link of seasonLinks) {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          // Check if this link contains our season number
          if ((href.includes(`season-${season}`) || href.includes(`season${season}`)) ||
              (text.includes(`موسم ${season}`) || text.includes(`Season ${season}`))) {
            seasonUrl = href.startsWith('http') ? href : (href.startsWith('/') ? this.baseUrl + href : `${this.baseUrl}/${href}`);
            break;
          }
        }
      }
      
      if (!seasonUrl) {
        throw new Error(`Season ${season} not found`);
      }
      
      // Get season page (if different from series page)
      let seasonDocument = document;
      if (seasonUrl !== seriesUrl) {
        const seasonResponse = await axios.get(seasonUrl, {
          headers: this.headers,
          timeout: 10000
        });
        
        const seasonDom = new JSDOM(seasonResponse.data);
        seasonDocument = seasonDom.window.document;
      }
      
      // Find episode link in the epAll container
      const epContainer = seasonDocument.querySelector('.epAll');
      
      if (!epContainer) {
        // Try looking for episode links directly
        const episodeLinks = seasonDocument.querySelectorAll('a[href*="episode"], a[href*="الحلقة"]');
        
        for (const link of episodeLinks) {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          // Check for episode number in Arabic or English
          const arabicMatch = text.match(/الحلقة\s+(\d+)/);
          const englishMatch = text.match(/Episode\s+(\d+)/i) || text.match(/E(\d+)/i);
          
          const matchedEpisode = arabicMatch ? parseInt(arabicMatch[1]) : 
                              (englishMatch ? parseInt(englishMatch[1]) : null);
          
          if (matchedEpisode === parseInt(episode)) {
            const episodeUrl = href.startsWith('http') ? href : (href.startsWith('/') ? this.baseUrl + href : `${this.baseUrl}/${href}`);
            return episodeUrl;
          }
        }
        
        throw new Error(`No episode container found and no matching episode links for episode ${episode}`);
      }
      
      // Process all episode links
      const episodeLinks = epContainer.querySelectorAll('a');
      
      for (const link of episodeLinks) {
        const text = link.textContent.trim();
        const href = link.getAttribute('href');
        
        // Check for Arabic episode number (الحلقة X)
        const arabicMatch = text.match(/الحلقة\s+(\d+)/);
        // Check for English episode number (Episode X or EX)
        const englishMatch = text.match(/Episode\s+(\d+)/i) || text.match(/E(\d+)/i);
        
        const matchedEpisode = arabicMatch ? parseInt(arabicMatch[1]) : 
                             (englishMatch ? parseInt(englishMatch[1]) : null);
        
        if (matchedEpisode === parseInt(episode)) {
          const episodeUrl = href.startsWith('http') ? href : (href.startsWith('/') ? this.baseUrl + href : `${this.baseUrl}/${href}`);
          return episodeUrl;
        }
      }
      
      throw new Error(`Episode ${episode} not found in season ${season}`);
    } catch (error) {
      console.error(`Error getting episode URL: ${error.message}`);
      throw new Error(`Failed to get episode URL: ${error.message}`);
    }
  }

  /**
   * Extract player URL from content page
   * @param {string} contentUrl - URL of the movie or episode page
   * @returns {Promise<string|null>} - URL of the video player
   */
  async extractPlayerUrl(contentUrl) {
    try {
      const response = await axios.get(contentUrl, {
        headers: this.headers,
        timeout: 10000
      });
      
      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      
      // Find the player iframe
      const iframe = document.querySelector('.player-iframe') || document.querySelector('iframe');
      if (iframe) {
        let playerUrl = iframe.getAttribute('src');
        
        // Ensure URL is absolute
        if (playerUrl.startsWith('//')) {
          playerUrl = 'https:' + playerUrl;
        } else if (playerUrl.startsWith('/')) {
          playerUrl = this.baseUrl + playerUrl;
        }
        
        return playerUrl;
      }
      
      // Alternative search method - look for data attributes
      const playerDiv = document.querySelector('[data-player]');
      if (playerDiv) {
        const playerData = playerDiv.getAttribute('data-player');
        try {
          const playerInfo = JSON.parse(playerData);
          if (playerInfo && playerInfo.url) {
            return playerInfo.url;
          }
        } catch (e) {
          console.error('Failed to parse player data:', e);
        }
      }
      
      throw new Error('Player URL not found');
    } catch (error) {
      console.error(`Error extracting player URL: ${error.message}`);
      throw new Error(`Failed to extract player URL: ${error.message}`);
    }
  }

  /**
   * Extract video URL from player using direct network monitoring
   * @param {string} playerUrl - URL of the video player
   * @returns {Promise<string|null>} - Direct video URL
   */
  async extractVideoFromPlayer(playerUrl) {
    let browser = null;
    try {
      browser = await puppeteerExtra.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--window-size=1366,768'
        ]
      });
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // Add cookie to bypass anti-bot
      await page.setCookie({
        name: 'fcuid',
        value: '43653ef215e35c1300dbb7612f17251c409594c8',
        domain: 'www.faselhds.care',
        path: '/'
      });
      
      // Track m3u8 URLs from network requests
      let foundVideoUrls = [];
      let masterUrl = null;
      
      // Network request interception
      await page.setRequestInterception(true);
      
      page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8')) {
          foundVideoUrls.push(url);
          
          // Prioritize master playlist
          if (url.includes('master.m3u8')) {
            masterUrl = url;
          }
        }
        
        // Continue the request
        request.continue();
      });
      
      // Navigate to the player page
      await page.goto(playerUrl, { 
        waitUntil: 'networkidle2', 
        timeout: 20000 
      });
      
      // Wait a moment for any delayed requests
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to click play button to trigger video loading if needed
      try {
        const playButtons = [
          'video',
          '.vjs-big-play-button',
          '.ytp-large-play-button',
          '.play-button',
          'button[aria-label="Play"]',
          '.play-icon'
        ];
        
        for (const selector of playButtons) {
          const playButton = await page.$(selector);
          if (playButton) {
            await playButton.click().catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 1000));
            break;
          }
        }
      } catch (err) {
        // Ignore play button errors
      }
      
      // If we found a master URL during navigation, use it
      if (!masterUrl && foundVideoUrls.length > 0) {
        // Look for master playlist in the found URLs
        masterUrl = foundVideoUrls.find(url => url.includes('master.m3u8'));
        if (!masterUrl) {
          // Or just use the highest quality URL based on naming pattern
          const hdUrl = foundVideoUrls.find(url => url.includes('hd1080'));
          masterUrl = hdUrl || foundVideoUrls[0];
        }
      }
      
      // If we still don't have a URL, extract URLs from network resources
      if (!masterUrl) {
        const m3u8Urls = await page.evaluate(() => {
          return Array.from(performance.getEntriesByType('resource'))
            .filter(resource => resource.name.includes('.m3u8'))
            .map(resource => resource.name);
        });
        
        if (m3u8Urls.length > 0) {
          // Prefer master playlist
          masterUrl = m3u8Urls.find(url => url.includes('master.m3u8'));
          if (!masterUrl) {
            // Or HD quality
            masterUrl = m3u8Urls.find(url => url.includes('hd1080'));
            if (!masterUrl) {
              masterUrl = m3u8Urls[0];
            }
          }
        }
      }
      
      // Make sure to capture the URL before closing the browser
      const finalVideoUrl = masterUrl;
      
      if (browser) {
        await browser.close();
      }
      
      return finalVideoUrl;
    } catch (error) {
      console.error(`Error extracting video from player: ${error.message}`);
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error(`Error closing browser: ${closeError.message}`);
        }
      }
      return null;
    }
  }

  /**
   * Get movie from FaselHD by TMDB ID
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  async getMovieByTmdbId(req, res) {
    try {
      const { tmdbId } = req.params;
      
      if (!tmdbId) {
        return res.status(400).json({
          success: false,
          message: 'TMDB ID is required'
        });
      }
      
      // Check cache
      const cacheKey = `faselhd_movie_${tmdbId}`;
      const cachedResult = faselhdCache.get(cacheKey);
      
      if (cachedResult) {
        return res.json({
          success: true,
          source: 'cache',
          data: cachedResult
        });
      }
      
      // Get movie details from TMDB API directly
      const tmdbData = await this.getMovieDetailsFromTMDB(tmdbId);
      
      if (!tmdbData) {
        return res.status(404).json({
          success: false,
          message: 'Movie not found on TMDB'
        });
      }
      
      // Search for the movie on FaselHD
      const searchResults = await this.searchOnFaselHD(tmdbData.title);
      const bestMatch = this.findBestMatch(searchResults, tmdbData.title, 'movie');
      
      if (!bestMatch) {
        return res.status(404).json({
          success: false,
          message: 'Movie not found on FaselHD',
          searchResults
        });
      }
      
      // Extract player URL
      const playerUrl = await this.extractPlayerUrl(bestMatch.url);
      
      if (!playerUrl) {
        return res.status(404).json({
          success: false,
          message: 'Player URL not found'
        });
      }
      
      // Use our direct video extraction method
      const videoUrl = await this.extractVideoFromPlayer(playerUrl);
      
      const result = {
        title: tmdbData.title,
        tmdbId,
        faselhdUrl: bestMatch.url,
        playerUrl,
        videoUrl
      };
      
      // Save to cache
      faselhdCache.set(cacheKey, result);
      
      return res.json({
        success: true,
        source: 'extraction',
        data: result
      });
    } catch (error) {
      console.error(`FaselHD movie error: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to get movie from FaselHD',
        error: error.message
      });
    }
  }

  /**
   * Get TV episode from FaselHD by TMDB ID
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  async getTvEpisodeByTmdbId(req, res) {
    try {
      const { tmdbId } = req.params;
      const { season, episode } = req.query;
      
      if (!tmdbId || !season || !episode) {
        return res.status(400).json({
          success: false,
          message: 'TMDB ID, season, and episode are required'
        });
      }
      
      // Check cache
      const cacheKey = `faselhd_tv_${tmdbId}_${season}_${episode}`;
      const cachedResult = faselhdCache.get(cacheKey);
      
      if (cachedResult) {
        return res.json({
          success: true,
          source: 'cache',
          data: cachedResult
        });
      }
      
      // Get TV show details from TMDB API directly
      const tmdbData = await this.getTVDetailsFromTMDB(tmdbId);
      
      if (!tmdbData) {
        return res.status(404).json({
          success: false,
          message: 'TV show not found on TMDB'
        });
      }
      
      // Search for the TV show on FaselHD
      const searchResults = await this.searchOnFaselHD(tmdbData.name);
      const bestMatch = this.findBestMatch(searchResults, tmdbData.name, 'tv');
      
      if (!bestMatch) {
        return res.status(404).json({
          success: false,
          message: 'TV show not found on FaselHD',
          searchResults
        });
      }
      
      // Get episode URL
      const episodeUrl = await this.getEpisodeUrl(bestMatch.url, season, episode);
      
      if (!episodeUrl) {
        return res.status(404).json({
          success: false,
          message: `Episode ${episode} of season ${season} not found`
        });
      }
      
      // Extract player URL
      const playerUrl = await this.extractPlayerUrl(episodeUrl);
      
      if (!playerUrl) {
        return res.status(404).json({
          success: false,
          message: 'Player URL not found'
        });
      }
      
      // Use our direct video extraction method
      const videoUrl = await this.extractVideoFromPlayer(playerUrl);
      
      const result = {
        title: tmdbData.name,
        tmdbId,
        season,
        episode,
        faselhdUrl: bestMatch.url,
        episodeUrl,
        playerUrl,
        videoUrl
      };
      
      // Save to cache
      faselhdCache.set(cacheKey, result);
      
      return res.json({
        success: true,
        source: 'extraction',
        data: result
      });
    } catch (error) {
      console.error(`FaselHD TV error: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to get TV episode from FaselHD',
        error: error.message
      });
    }
  }
}

export const faselhdController = new FaselHDController(); 