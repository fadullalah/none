import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import NodeCache from 'node-cache';
import { bunnyStreamController } from './bunny.controller.js';
import axios from 'axios';
import fs from 'fs';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a cache for storing ShowBox results (TTL: 6 hours)
const showboxCache = new NodeCache({ stdTTL: 21600 });

// Add these near the top with other cache declarations
const imdbCache = new NodeCache({ stdTTL: 86400 }); // 24 hours
const urlCache = new NodeCache({ stdTTL: 43200 }); // 12 hours

// Path to our JSON database file
const CONTENT_DB_PATH = path.join(__dirname, '../../data/uploaded_content.json');

// Quality priority (highest to lowest)
const QUALITY_PRIORITY = [
  '4K HDR', '4K', 'ORIGINAL', '1080P HDR', '1080P', '720P', '480P', '360P'
];

const SCRAPER_API_KEY = '169e05c208dcbe5e453edd9c5957cc40';
const UI_TOKENS = [
'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjM4MjYsIm5iZiI6MTc0MjU2MzgyNiwiZXhwIjoxNzczNjY3ODQ2LCJkYXRhIjp7InVpZCI6NjIzMzk2LCJ0b2tlbiI6IjUxZTVlMGQ5OTk5ZmYyNGNhNDU3Mjc0Y2Q2YTVhMmRmIn19.h5TNhw5vVjBdcyXruSSO3y_HfopZNr1NoEiAQBN0Rfk',
'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3Mzg3NzAxNjUsIm5iZiI6MTczODc3MDE2NSwiZXhwIjoxNzY5ODc0MTg1LCJkYXRhIjp7InVpZCI6Mzc2ODAyLCJ0b2tlbiI6IjkzNzM1MzViOTk3Yjk4ZmM5ZGY0YjVkYzA2ZWRjN2RiIn19.A3PZeqXtQm4YnxR4yOSHDnTDx4hayAC1VvD-s6aBEzo',
'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjQwMjksIm5iZiI6MTc0MjU2NDAyOSwiZXhwIjoxNzczNjY4MDQ5LCJkYXRhIjp7InVpZCI6NDUxMDE1LCJ0b2tlbiI6IjEyZjQ3YWFiNGJhMWQ5OGI1YmU3MzU3YWRmNzU2NGI3In19.Tpcpf2au_NEAhVLfrk153M6r07tkcHS-6hh9E5SKtlE',
'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjQxNDAsIm5iZiI6MTc0MjU2NDE0MCwiZXhwIjoxNzczNjY4MTYwLCJkYXRhIjp7InVpZCI6NjIzMzkxLCJ0b2tlbiI6IjQ0NGQ3ZjFhZTI1YzJkYjU2MjkwYWJhMWNmZWNjMzdjIn19.GjtPfpZP2mSXGc43ZMmO_tK5BS6AYFMbHT4f_rN1E9I'
];

function getScraperUrl(url) {
  return `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
}

async function getPythonScrapedLinks(shareUrl, uiToken) {
  return new Promise((resolve, reject) => {
    // Construct the absolute path to the Python script
    const pythonScriptPath = path.join(__dirname, '..', 'scripts', 'showbox.py');
    console.log('🐍 Python script path:', pythonScriptPath);

    const pythonProcess = spawn('python', [pythonScriptPath, shareUrl, uiToken]);
    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('🐍 Python output:', output);
      outputData += output;
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('⚠️ Python stderr:', error);
      errorData += error;
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ Python scraper error:', errorData);
        reject(new Error(`Python scraper failed: ${errorData}`));
        return;
      }

      try {
        console.log('✅ Python process completed, parsing results...');
        const results = JSON.parse(outputData);
        resolve(results);
      } catch (error) {
        console.error('❌ Failed to parse Python output:', error);
        reject(new Error('Failed to parse Python scraper output: ' + error.message));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('❌ Python process error:', error);
      reject(new Error('Failed to start Python scraper: ' + error.message));
    });
  });
}

async function searchShowboxByTitle(title, type, year) {
  console.log(`🔎 Searching ShowBox for: "${title}" (${year}) [${type}]`);
  const searchUrl = getScraperUrl(`https://showbox.media/search?keyword=${encodeURIComponent(title)}`);
  
  const response = await fetch(searchUrl);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const results = $('.flw-item').map((_, item) => {
    const link = $(item).find('.film-poster-ahref').attr('href');
    const itemTitle = $(item).find('.film-name').text().trim();
    const yearText = $(item).find('.film-year, .year, [class*="year"]').text().trim();
    const yearMatch = yearText.match(/\d{4}/);
    const itemYear = yearMatch ? parseInt(yearMatch[0]) : null;
    
    // Extract ID from the link - handle both /detail/ and /tv/t- or /movie/m- formats
    let id = null;
    if (link) {
      const detailMatch = link.match(/\/detail\/(\d+)/);
      if (detailMatch) {
        id = detailMatch[1];
      } else {
        // Extract ID from URL format like /tv/t-taskmaster-2015
        const urlMatch = link.match(/\/(tv|movie)\/[mt]-(.+?)-(\d+)$/);
        if (urlMatch) {
          id = `${urlMatch[2]}-${urlMatch[3]}`;  // Create an ID from the slug
        }
      }
    }
    
    return { 
      title: itemTitle, 
      year: itemYear, 
      link, 
      id,
      fullUrl: `https://showbox.media${link}`
    };
  }).get();

  // First try exact match
  let match = results.find(result => {
    const titleMatch = result.title.toLowerCase() === title.toLowerCase();
    const yearMatch = !year || !result.year || Math.abs(result.year - year) <= 1;
    return titleMatch && yearMatch;
  });

  // If no exact match, try partial match
  if (!match) {
    match = results.find(result => {
      const titleMatch = result.title.toLowerCase().includes(title.toLowerCase());
      // For TV shows, be more lenient with year matching since they run multiple years
      const yearMatch = type === 'tv' ? true : (!year || !result.year || Math.abs(result.year - year) <= 2);
      return titleMatch && yearMatch;
    });
  }

  // If still no match, return the first result that contains the title
  if (!match) {
    match = results.find(result => 
      result.title.toLowerCase().includes(title.toLowerCase())
    );
  }

  // If we found a match but need to get its detail page ID
  if (match && !match.id.match(/^\d+$/)) {
    try {
      // Fetch the detail page to get the numeric ID
      const detailResponse = await fetch(getScraperUrl(match.fullUrl));
      const detailHtml = await detailResponse.text();
      const $detail = cheerio.load(detailHtml);
      
      // Look for the ID in various places
      const watchButton = $detail('.watch-now').attr('href');
      const detailMatch = watchButton?.match(/\/detail\/(\d+)/) || 
                         detailHtml.match(/\/detail\/(\d+)/);
      
      if (detailMatch) {
        match.id = detailMatch[1];
      }
    } catch (error) {
      console.error('Failed to fetch detail page:', error);
    }
  }

  console.log('🔍 Search results:', results.length ? results : 'No results');
  console.log('✅ Best match:', match || 'No match found');

  return match;
}

async function getFebboxShareLink(showboxId, type) {
  const apiUrl = getScraperUrl(`https://showbox.media/index/share_link?id=${showboxId}&type=${type === 'movie' ? 1 : 2}`);
  const response = await fetch(apiUrl);
  const data = await response.json();
  
  if (data.code !== 1 || !data.data?.link) {
    throw new Error('Failed to get FebBox share link');
  }
  
  return data.data.link;
}

async function getStreamLinks(fid) {
  console.log(`🎯 Getting stream links for file ID: ${fid}`);
  const randomToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];

  const playerResponse = await fetch("https://www.febbox.com/console/player", {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      'cookie': `ui=${randomToken}`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'origin': 'https://www.febbox.com',
      'referer': 'https://www.febbox.com/file/share'
    },
    body: new URLSearchParams({
      'fid': fid,
      'share_key': '',
      '_token': randomToken
    }).toString()
  });

  const playerHtml = await playerResponse.text();
  const sourcesMatch = playerHtml.match(/var sources = (\[.*?\]);/s);
  
  if (!sourcesMatch) {
    console.log('⚠️ No stream sources found in player HTML');
    return [];
  }

  const sources = JSON.parse(sourcesMatch[1]);
  return sources.map(source => ({
    file: source.file,
    quality: source.label,
    type: source.type
  }));
}

async function searchIMDB(title) {
  // Check cache first
  const cacheKey = `imdb:${title.toLowerCase()}`;
  const cached = imdbCache.get(cacheKey);
  if (cached) {
    console.log('📦 Using cached IMDB results');
    return cached;
  }

  try {
    const response = await fetch(`https://www.imdb.com/find/?q=${encodeURIComponent(title)}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const results = [];
    $('.find-title-result').each((_, item) => {
      const title = $(item).find('.ipc-metadata-list-summary-item__t').text().trim();
      const yearText = $(item).find('.ipc-metadata-list-summary-item__li').first().text().trim();
      const yearMatch = yearText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;
      const isTV = $(item).text().toLowerCase().includes('tv series');
      
      if (isTV) {
        results.push({ title, year });
      }
    });
    
    // Cache the results
    imdbCache.set(cacheKey, results);
    return results;
  } catch (error) {
    console.error('❌ IMDB search failed:', error);
    return [];
  }
}

async function tryUrlBasedId(title, year, type) {
  const formattedTitle = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const prefix = type === 'movie' ? 'm-' : 't-';
  
  // Check URL cache first
  const cacheKey = `url:${type}:${formattedTitle}:${year}`;
  const cachedId = urlCache.get(cacheKey);
  if (cachedId) {
    console.log('📦 Using cached ShowBox ID');
    return cachedId;
  }

  // First try with the provided year
  const url = `https://showbox.media/${type}/${prefix}${formattedTitle}-${year}`;
  
  console.log(`🎯 Trying URL: ${url}`);
  try {
    const response = await fetch(getScraperUrl(url));
    
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      
      const detailUrl = $('link[rel="canonical"]').attr('href') || 
                     $('.watch-now').attr('href') || 
                     $('a[href*="/detail/"]').attr('href');
                     
      if (detailUrl) {
        const idMatch = detailUrl.match(/\/detail\/(\d+)/);
        if (idMatch) {
          urlCache.set(cacheKey, idMatch[1]);
          console.log(`✅ Found ID via URL approach: ${idMatch[1]} (${url})`);
          return idMatch[1];
        }
      }
    }

    // Only if first attempt failed, try IMDB years as fallback
    console.log('⚠️ Initial URL attempt failed, trying IMDB fallback...');
    const imdbResults = await searchIMDB(title);
    
    // Sort years by closest to target year
    imdbResults.sort((a, b) => {
      const aDiff = Math.abs((a.year || 0) - year);
      const bDiff = Math.abs((b.year || 0) - year);
      return aDiff - bDiff;
    });

    // Try all IMDB years in parallel
    const yearAttempts = imdbResults
      .filter(result => result.year && result.year !== year)
      .map(async (result) => {
        const fallbackUrl = `https://showbox.media/${type}/${prefix}${formattedTitle}-${result.year}`;
        console.log(`🎯 Trying year ${result.year}`);
        
        try {
          const fallbackResponse = await fetch(getScraperUrl(fallbackUrl));
          if (!fallbackResponse.ok) return null;

          const fallbackHtml = await fallbackResponse.text();
          const $fallback = cheerio.load(fallbackHtml);
          
          const fallbackDetailUrl = $fallback('link[rel="canonical"]').attr('href') || 
                                  $fallback('.watch-now').attr('href') || 
                                  $fallback('a[href*="/detail/"]').attr('href');
                                  
          if (fallbackDetailUrl) {
            const fallbackIdMatch = fallbackDetailUrl.match(/\/detail\/(\d+)/);
            if (fallbackIdMatch) {
              return {
                id: fallbackIdMatch[1],
                url: fallbackUrl,
                year: result.year
              };
            }
          }
          return null;
        } catch (error) {
          console.error(`❌ Error trying year ${result.year}:`, error);
          return null;
        }
      });

    // Wait for all attempts to complete and get the first successful result
    const results = await Promise.all(yearAttempts);
    const successfulResult = results.find(r => r !== null);
    
    if (successfulResult) {
      urlCache.set(cacheKey, successfulResult.id);
      console.log(`✅ Found ID via IMDB fallback: ${successfulResult.id} (${successfulResult.url})`);
      return successfulResult.id;
    }
  } catch (error) {
    console.error(`❌ Error in tryUrlBasedId:`, error);
  }
  
  console.log('⚠️ URL-based approach failed for all attempts');
  return null;
}

async function fetchFebboxFiles(shareKey, parentId = 0) {
  const randomToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
  const fileListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${parentId}`;
  
  const response = await fetch(fileListUrl, {
    headers: {
      'cookie': `ui=${randomToken}`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const data = await response.json();
  
  if (!data?.data?.file_list) {
    throw new Error('Failed to fetch Febbox files');
  }
  
  return data.data.file_list;
}

// Replace the extractHighestQualityStream function with this enhanced version
function extractTopQualityStreams(streams) {
  if (!streams) return { primary: null, secondary: null };
  
  // For individual stream with player_streams property
  if (streams.player_streams && Array.isArray(streams.player_streams)) {
    // Define quality priority order (highest to lowest)
    const qualityOrder = ['original', 'org', '4k', '2160p', '1080p', '720p', '480p', '360p'];
    
    // Sort player_streams by quality
    const sortedStreams = [...streams.player_streams].sort((a, b) => {
      const aQuality = (a.quality || '').toLowerCase();
      const bQuality = (b.quality || '').toLowerCase();
      
      // Check for original quality first
      if (aQuality.includes('original') || aQuality.includes('org')) return -1;
      if (bQuality.includes('original') || bQuality.includes('org')) return 1;
      
      // Find the index in our priority list (lower index = higher quality)
      const aIndex = qualityOrder.findIndex(q => aQuality.includes(q));
      const bIndex = qualityOrder.findIndex(q => bQuality.includes(q));
      
      // If quality not found in our list, give it lowest priority
      const aQualityValue = aIndex >= 0 ? aIndex : qualityOrder.length;
      const bQualityValue = bIndex >= 0 ? bIndex : qualityOrder.length;
      
      return aQualityValue - bQualityValue;
    });
    
    const primaryStream = sortedStreams[0]?.file || null;
    const secondaryStream = sortedStreams[1]?.file || null;
    
    return { 
      primary: primaryStream, 
      secondary: secondaryStream,
      primaryQuality: sortedStreams[0]?.quality || 'Unknown',
      secondaryQuality: sortedStreams[1]?.quality || 'Unknown'
    };
  }
  
  // For array of streams or files
  if (Array.isArray(streams)) {
    // Check if it's an array of player_streams directly
    if (streams.length > 0 && streams[0] && 'file' in streams[0]) {
      // Define quality priority order (highest to lowest)
      const qualityOrder = ['original', 'org', '4k', '2160p', '1080p', '720p', '480p', '360p'];
      
      // Sort by quality
      const sortedStreams = [...streams].sort((a, b) => {
        const aQuality = (a.quality || '').toLowerCase();
        const bQuality = (b.quality || '').toLowerCase();
        
        // Check for original quality first
        if (aQuality.includes('original') || aQuality.includes('org')) return -1;
        if (bQuality.includes('original') || bQuality.includes('org')) return 1;
        
        const aIndex = qualityOrder.findIndex(q => aQuality.includes(q));
        const bIndex = qualityOrder.findIndex(q => bQuality.includes(q));
        
        const aQualityValue = aIndex >= 0 ? aIndex : qualityOrder.length;
        const bQualityValue = bIndex >= 0 ? bIndex : qualityOrder.length;
        
        return aQualityValue - bQualityValue;
      });
      
      const primaryStream = sortedStreams[0]?.file || null;
      const secondaryStream = sortedStreams[1]?.file || null;
      
      return { 
        primary: primaryStream, 
        secondary: secondaryStream,
        primaryQuality: sortedStreams[0]?.quality || 'Unknown',
        secondaryQuality: sortedStreams[1]?.quality || 'Unknown'
      };
    }
    
    // For array of files with individual player_streams
    const filesWithStreams = streams.filter(stream => 
      stream && stream.player_streams && Array.isArray(stream.player_streams)
    );
    
    if (filesWithStreams.length > 0) {
      // Extract top qualities from each file
      const qualityResults = filesWithStreams
        .map(stream => extractTopQualityStreams(stream))
        .filter(result => result.primary);
      
      if (qualityResults.length > 0) {
        return qualityResults[0];  // Return the first valid result
      }
    }
  }
  
  return { primary: null, secondary: null };
}

class ShowboxController {
  constructor() {
    this.baseUrl = 'https://showbox.shegu.net/api/api_client.php';
    this.apiKey = 'showbox'; // Default API key for ShowBox
    this.contentDb = this.loadContentDb();
  }

  /**
   * Load the content database from JSON file
   * @returns {Object} The loaded database
   */
  loadContentDb() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(CONTENT_DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Create file if it doesn't exist
      if (!fs.existsSync(CONTENT_DB_PATH)) {
        fs.writeFileSync(CONTENT_DB_PATH, JSON.stringify({
          movies: {},
          shows: {}
        }));
      }
      
      return JSON.parse(fs.readFileSync(CONTENT_DB_PATH, 'utf8'));
    } catch (error) {
      console.error(`Error loading content database: ${error.message}`);
      return { movies: {}, shows: {} };
    }
  }

  /**
   * Save the content database to JSON file
   */
  saveContentDb() {
    try {
      fs.writeFileSync(CONTENT_DB_PATH, JSON.stringify(this.contentDb, null, 2));
    } catch (error) {
      console.error(`Error saving content database: ${error.message}`);
    }
  }

  /**
   * Check if content is already uploaded
   * @param {string} type - 'movie' or 'tv'
   * @param {string} tmdbId - TMDB ID
   * @param {string} [season] - Season number (for TV shows)
   * @param {string} [episode] - Episode number (for TV shows)
   * @returns {Object|null} Cached content info or null
   */
  getUploadedContent(type, tmdbId, season = null, episode = null) {
    const collection = type === 'movie' ? this.contentDb.movies : this.contentDb.shows;
    
    if (type === 'movie') {
      return collection[tmdbId] || null;
    } else {
      if (!collection[tmdbId]) return null;
      if (!season || !episode) return collection[tmdbId];
      
      if (collection[tmdbId].episodes && 
          collection[tmdbId].episodes[season] && 
          collection[tmdbId].episodes[season][episode]) {
        return collection[tmdbId].episodes[season][episode];
      }
      
      return null;
    }
  }

  /**
   * Record uploaded content
   * @param {string} type - 'movie' or 'tv'
   * @param {string} tmdbId - TMDB ID
   * @param {Object} contentInfo - Content info to store
   * @param {string} [season] - Season number (for TV shows)
   * @param {string} [episode] - Episode number (for TV shows)
   */
  recordUploadedContent(type, tmdbId, contentInfo, season = null, episode = null) {
    const collection = type === 'movie' ? this.contentDb.movies : this.contentDb.shows;
    
    if (type === 'movie') {
      collection[tmdbId] = contentInfo;
    } else {
      if (!collection[tmdbId]) {
        collection[tmdbId] = { episodes: {} };
      }
      
      if (!collection[tmdbId].episodes) {
        collection[tmdbId].episodes = {};
      }
      
      if (season && episode) {
        if (!collection[tmdbId].episodes[season]) {
          collection[tmdbId].episodes[season] = {};
        }
        
        collection[tmdbId].episodes[season][episode] = contentInfo;
      } else {
        Object.assign(collection[tmdbId], contentInfo);
      }
    }
    
    this.saveContentDb();
  }

  /**
   * Get showbox URL for a movie or TV show
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode } = req.query;

    try {
      // Check if content is already in our database
      const cachedContent = this.getUploadedContent(type, tmdbId, season, episode);
      if (cachedContent) {
        return res.json({
          success: true,
          url: cachedContent.url,
          quality: cachedContent.quality,
          source: 'database',
          ...cachedContent
        });
      }

      // Check if request is in cache
      const cacheKey = `showbox_${type}_${tmdbId}_${season || ''}_${episode || ''}`;
      const cachedResult = showboxCache.get(cacheKey);
      if (cachedResult) {
        return res.json({
          success: true,
          ...cachedResult,
          source: 'cache'
        });
      }

      // Proceed with API request based on content type
      let apiUrl, apiParams;

      if (type === 'movie') {
        apiUrl = this.baseUrl;
        apiParams = {
          ac: 'detail',
          type: 'movie',
          id: tmdbId,
          key: this.apiKey
        };
      } else if (type === 'tv') {
        if (!season || !episode) {
          throw new Error('Season and episode are required for TV shows');
        }

        apiUrl = this.baseUrl;
        apiParams = {
          ac: 'detail',
          type: 'tv',
          id: tmdbId,
          season: season,
          episode: episode,
          key: this.apiKey
        };
      } else {
        throw new Error('Invalid content type. Must be "movie" or "tv"');
      }

      // Make request to ShowBox API
      const response = await axios.get(apiUrl, { params: apiParams });
      
      if (!response.data || response.data.status !== 1) {
        throw new Error('Failed to get content information from ShowBox');
      }

      // Process the video sources
      const result = await this.processVideoSources(
        response.data, type, tmdbId, season, episode
      );
      
      // Cache the result
      showboxCache.set(cacheKey, result);

      // Return result to client
      return res.json({
        success: true,
        ...result,
        source: 'api'
      });
    } catch (error) {
      console.error(`Showbox error for ${type} ${tmdbId}: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Process video sources, prioritize quality and upload to Bunny if needed
   * @param {Object} data - API response data
   * @param {string} type - Content type (movie/tv)
   * @param {string} tmdbId - TMDB ID
   * @param {string} [season] - Season number (for TV shows)
   * @param {string} [episode] - Episode number (for TV shows)
   * @returns {Object} Processed video information
   */
  async processVideoSources(data, type, tmdbId, season = null, episode = null) {
    let videoSources = [];
    let bestSource = null;
    
    // Extract video sources from API response
    if (data.videos && data.videos.length > 0) {
      videoSources = data.videos.filter(v => 
        v.link && typeof v.link === 'string' && v.link.trim() !== ''
      );
    }
    
    if (videoSources.length === 0) {
      throw new Error('No valid video sources found');
    }
    
    // Block febbox.com/video/vip_only.mp4 URL
    videoSources = videoSources.filter(source => 
      !source.link.includes('febbox.com/video/vip_only.mp4')
    );
    
    if (videoSources.length === 0) {
      throw new Error('Only restricted videos found');
    }
    
    // Get quality info for each source and sort by priority
    const sourcesWithQuality = videoSources.map(source => {
      // Extract quality from source data
      let quality = 'UNKNOWN';
      
      if (source.quality) {
        quality = source.quality.toUpperCase();
      } else if (source.link.includes('4k') || source.link.includes('2160p')) {
        quality = source.link.includes('hdr') ? '4K HDR' : '4K';
      } else if (source.link.includes('1080p') || source.link.includes('1080P')) {
        quality = source.link.includes('hdr') ? '1080P HDR' : '1080P';
      } else if (source.link.includes('720p') || source.link.includes('720P')) {
        quality = '720P';
      } else if (source.link.includes('480p') || source.link.includes('480P')) {
        quality = '480P';
      } else if (source.link.includes('360p') || source.link.includes('360P')) {
        quality = '360P';
      }
      
      return {
        ...source,
        quality,
        priorityIndex: QUALITY_PRIORITY.indexOf(quality) !== -1 
          ? QUALITY_PRIORITY.indexOf(quality) 
          : QUALITY_PRIORITY.length
      };
    });
    
    // Sort by quality priority (lowest index = highest priority)
    sourcesWithQuality.sort((a, b) => a.priorityIndex - b.priorityIndex);
    
    // Get the best quality source
    bestSource = sourcesWithQuality[0];
    
    // Upload to Bunny Stream if not already in our database
    const title = `${type === 'movie' ? 'Movie' : 'TV'} ${tmdbId}${season ? ` S${season}E${episode}` : ''}`;
    
    try {
      // Upload to Bunny
      const uploadResult = await bunnyStreamController.uploadVideoByUrl(
        bestSource.link,
        title
      );
      
      if (uploadResult.success) {
        // Create a record with quality info
        const contentInfo = {
          url: uploadResult.directPlayUrl || uploadResult.embedUrl,
          quality: bestSource.quality,
          uploadedAt: new Date().toISOString(),
          videoId: uploadResult.videoId,
          originalSource: bestSource.link
        };
        
        // Record in our database
        this.recordUploadedContent(type, tmdbId, contentInfo, season, episode);
        
        return {
          url: contentInfo.url,
          quality: contentInfo.quality,
          videoId: contentInfo.videoId,
          provider: 'bunny'
        };
      } else {
        // If upload failed, return direct source as fallback
        console.error(`Failed to upload to Bunny: ${uploadResult.error}`);
        return {
          url: bestSource.link,
          quality: bestSource.quality,
          provider: 'direct'
        };
      }
    } catch (error) {
      console.error(`Error uploading to Bunny: ${error.message}`);
      return {
        url: bestSource.link,
        quality: bestSource.quality,
        provider: 'direct',
        error: error.message
      };
    }
  }
}

export const showboxController = new ShowboxController();