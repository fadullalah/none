import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Redis configuration
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Cache TTL values (reduced for cost-effectiveness)
const CACHE_TTL = {
  SHOWBOX: 3600, // 1 hour (was 4 hours)
  IMDB: 86400, // 24 hours (was 48 hours)
  URL: 3600, // 1 hour (was 12 hours)
  STREAM_LINKS: 1800 // 30 minutes (was 1 hour)
};

// Redis cache helper functions
class RedisCache {
  constructor() {
    this.baseUrl = REDIS_URL;
    this.token = REDIS_TOKEN;
  }

  async get(key) {
    try {
      const response = await fetch(`${this.baseUrl}/get/${encodeURIComponent(key)}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      if (!response.ok) {
        console.log(`Redis GET failed for key: ${key}, status: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      return data.result ? JSON.parse(data.result) : null;
    } catch (error) {
      console.log(`Redis GET error for key: ${key}:`, error.message);
      return null;
    }
  }

  async set(key, value, ttl = 3600) {
    try {
      // Upstash Redis REST API expects EX as a query parameter for SET
      const url = `${this.baseUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttl}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
        // Remove body - EX parameter is now in query string
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Redis SET failed for key: ${key}, status: ${response.status}, response: ${errorText}`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.log(`Redis SET error for key: ${key}:`, error.message);
      return false;
    }
  }

  async del(key) {
    try {
      const response = await fetch(`${this.baseUrl}/del/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      return response.ok;
    } catch (error) {
      console.log(`Redis DEL error for key: ${key}:`, error.message);
      return false;
    }
  }

  async flushAll() {
    try {
      const response = await fetch(`${this.baseUrl}/flushall`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      return response.ok;
    } catch (error) {
      console.log('Redis FLUSHALL error:', error.message);
      return false;
    }
  }
}

// Initialize Redis cache
const redisCache = new RedisCache();

// Constants
const SCRAPER_API_KEY = '169e05c208dcbe5e453edd9c5957cc40';
const UI_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjM4MjYsIm5iZiI6MTc0MjU2MzgyNiwiZXhwIjoxNzczNjY3ODQ2LCJkYXRhIjp7InVpZCI6NjIzMzk2LCJ0b2tlbiI6IjUxZTVlMGQ5OTk5ZmYyNGNhNDU3Mjc0Y2Q2YTVhMmRmIn19.h5TNhw5vVjBdcyXruSSO3y_HfopZNr1NoEiAQBN0Rfk',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3Mzg3NzAxNjUsIm5iZiI6MTczODc3MDE2NSwiZXhwIjoxNzY5ODc0MTg1LCJkYXRhIjp7InVpZCI6Mzc2ODAyLCJ0b2tlbiI6IjkzNzM1MzViOTk3Yjk4ZmM5ZGY0YjVkYzA2ZWRjN2RiIn19.A3PZeqXtQm4YnxR4yOSHDnTDx4hayAC1VvD-s6aBEzo',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjQwMjksIm5iZiI6MTc0MjU2NDAyOSwiZXhwIjoxNzczNjY4MDQ5LCJkYXRhIjp7InVpZCI6NDUxMDE1LCJ0b2tlbiI6IjEyZjQ3YWFiNGJhMWQ5OGI1YmU3MzU3YWRmNzU2NGI3In19.Tpcpf2au_NEAhVLfrk153M6r07tkcHS-6hh9E5SKtlE',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI1NjQxNDAsIm5iZiI6MTc0MjU2NDE0MCwiZXhwIjoxNzczNjY4MTYwLCJkYXRhIjp7InVpZCI6NjIzMzkxLCJ0b2tlbiI6IjQ0NGQ3ZjFhZTI1YzJkYjU2MjkwYWJhMWNmZWNjMzdjIn19.GjtPfpZP2mSXGc43ZMmO_tK5BS6AYFMbHT4f_rN1E9I',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI2MDEwMTksIm5iZiI6MTc0MjYwMTAxOSwiZXhwIjoxNzczNzA1MDM5LCJkYXRhIjp7InVpZCI6NDg4NDc5LCJ0b2tlbiI6ImE1ZGI0ZmU1OGQ1YzI5YmE1OTZhZDlhYjkyZTBjNzI1In19.d2s2L0j1c4sVeJkRieZD2aoREh-WTjLvPSCnkCdtiBM',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDI2MTUxNjEsIm5iZiI6MTc0MjYxNTE2MSwiZXhwIjoxNzczNzE5MTgxLCJkYXRhIjp7InVpZCI6Njg5Njk2LCJ0b2tlbiI6ImRmZWMyZDdhOWRiNTRkYWE1NzYwNWE5NjcyYjhkODAwIn19.SlVYXj_IMWwRUuCvC2cXOAaVLEqgzexEC4NEiJqupSo',
];
const FETCH_TIMEOUT = 8000;

// Core functions
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

const getBestQualitySource = (sources) => {
  if (!sources || !Array.isArray(sources) || sources.length === 0) return null;
  
  const qualityScore = {
    '4K HDR': 100, '4K': 90, 'ORIGINAL': 85, '1080P': 80, 
    '720P': 70, '480P': 60, '360P': 50
  };
  
  return sources.sort((a, b) => {
    const aQuality = (a.quality || '').toUpperCase();
    const bQuality = (b.quality || '').toUpperCase();
    
    for (const q in qualityScore) {
      const aHas = aQuality.includes(q);
      const bHas = bQuality.includes(q);
      
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
    }
    
    return 0;
  })[0];
};

function getScraperUrl(url) {
  return `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
}

async function getStreamLinks(fid, customToken = null, shareKey = null, retryCount = 0) {
  const cacheKey = `stream:${fid}`;
  const cached = await redisCache.get(cacheKey);
  if (cached) return cached;
  
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second base delay
  
  const token = customToken || UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];

  try {
    const playerResponse = await fetch("https://www.febbox.com/console/player", {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'cookie': `ui=${token}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'origin': 'https://www.febbox.com',
        'referer': 'https://www.febbox.com/file/share'
      },
      body: new URLSearchParams({
        'fid': fid,
        'share_key': shareKey || '',
        '_token': token
      }).toString()
    });

    if (!playerResponse.ok) {
      throw new Error(`HTTP ${playerResponse.status}: ${playerResponse.statusText}`);
    }

    const playerHtml = await playerResponse.text();
    
    // Validate that we got actual HTML content
    if (!playerHtml || playerHtml.length < 100) {
      throw new Error('Received empty or invalid HTML response');
    }
    
    let sourcesMatch = playerHtml.match(/var sources = (\[.*?\]);/s);
    
    if (!sourcesMatch) {
      // Check if we got an error page or different response format
      if (playerHtml.includes('error') || playerHtml.includes('Error')) {
        throw new Error('FebBox returned an error page');
      }
      
      // Try alternative patterns
      sourcesMatch = playerHtml.match(/sources\s*=\s*(\[.*?\]);/s) || 
                      playerHtml.match(/var\s+playerSources\s*=\s*(\[.*?\]);/s);
      
      if (!sourcesMatch) {
        throw new Error('No sources found in player response');
      }
    }

    let sources;
    try {
      sources = JSON.parse(sourcesMatch[1]);
    } catch (parseError) {
      throw new Error(`Failed to parse sources JSON: ${parseError.message}`);
    }
    
    // Validate sources structure
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('Sources array is empty or invalid');
    }
    
    // Validate that sources have required properties
    const validSources = sources.filter(source => {
      return source && typeof source === 'object' && 
             (source.file || source.src || source.url) && 
             (source.quality || source.label);
    });
    
    if (validSources.length === 0) {
      throw new Error('No valid sources found in response');
    }
    
    await redisCache.set(cacheKey, validSources, CACHE_TTL.STREAM_LINKS);
    return validSources;
    
  } catch (error) {
    // Retry logic with exponential backoff
    if (retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000; // Add jitter
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Try with a different token on retry
      const newToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
      return getStreamLinks(fid, newToken, shareKey, retryCount + 1);
    }
    
    // If all retries failed, return empty array
    return [];
  }
}

async function searchIMDB(title) {
  const cacheKey = `imdb:${title.toLowerCase()}`;
  const cached = await redisCache.get(cacheKey);
  if (cached) return cached;

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
      
      if (isTV) results.push({ title, year });
    });
    
    await redisCache.set(cacheKey, results, CACHE_TTL.IMDB);
    return results;
  } catch (error) {
    return [];
  }
}

async function searchShowboxByTitle(title, type, year) {
  const searchUrl = getScraperUrl(`https://showbox.media/search?keyword=${encodeURIComponent(title)}`);
  
  const response = await fetchWithTimeout(searchUrl);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const results = $('.flw-item').map((_, item) => {
    const link = $(item).find('.film-poster-ahref').attr('href');
    const itemTitle = $(item).find('.film-name').text().trim();
    const yearText = $(item).find('.film-year, .year, [class*="year"]').text().trim();
    const yearMatch = yearText.match(/\d{4}/);
    const itemYear = yearMatch ? parseInt(yearMatch[0]) : null;
    
    let id = null;
    if (link) {
      const detailMatch = link.match(/\/detail\/(\d+)/);
      if (detailMatch) {
        id = detailMatch[1];
      } else {
        const urlMatch = link.match(/\/(tv|movie)\/[mt]-(.+?)-(\d+)$/);
        if (urlMatch) {
          id = `${urlMatch[2]}-${urlMatch[3]}`;
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

  // Fallback: search for <a> with title attribute matching the search title (case-insensitive)
  if (!match) {
    // Find all .flw-item elements
    $('.flw-item').each((_, item) => {
      // Find <a> with class 'film-poster-ahref' and a title attribute
      const aTag = $(item).find('a.film-poster-ahref[title]');
      const aTitle = aTag.attr('title');
      if (aTitle && aTitle.trim().toLowerCase() === title.trim().toLowerCase()) {
        const link = aTag.attr('href');
        // Also get the visible title from .film-name if possible
        const itemTitle = $(item).find('.film-name').text().trim() || aTitle.trim();
        match = {
          title: itemTitle,
          year: null, // year extraction could be added if needed
          link,
          id: null,
          fullUrl: link ? `https://showbox.media${link}` : null
        };
        return false; // break out of .each
      }
    });
  }

  // Special condition for Squid Game
  if (!match && title.toLowerCase() === 'squid game') {
    match = {
      title: 'Squid Game',
      year: 2021,
      link: '/tv/t-ojing-eo-geim-2021',
      id: null,
      fullUrl: 'https://www.showbox.media/tv/t-ojing-eo-geim-2021'
    };
  }

  // If we found a match but need to get its detail page ID
  if (match && match.link && (!match.id || !match.id.match(/^[0-9]+$/))) {
    try {
      const detailResponse = await fetch(getScraperUrl(match.fullUrl));
      const detailHtml = await detailResponse.text();
      const $detail = cheerio.load(detailHtml);
      const watchButton = $detail('.watch-now').attr('href');
      const detailMatch = watchButton?.match(/\/detail\/(\d+)/) || 
                         detailHtml.match(/\/detail\/(\d+)/);
      if (detailMatch) {
        match.id = detailMatch[1];
      }
    } catch (error) {
      // Failed to fetch detail page
    }
  }

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

async function tryUrlBasedId(title, year, type) {
  const formattedTitle = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const prefix = type === 'movie' ? 'm-' : 't-';
  
  const cacheKey = `url:${type}:${formattedTitle}:${year}`;
  const cachedId = await redisCache.get(cacheKey);
  if (cachedId) return cachedId;

  const url = `https://showbox.media/${type}/${prefix}${formattedTitle}-${year}`;
  
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
          await redisCache.set(cacheKey, idMatch[1], CACHE_TTL.URL);
          return idMatch[1];
        }
      }
    }

    // Try IMDB years as fallback
    const imdbResults = await searchIMDB(title);
    
    imdbResults.sort((a, b) => {
      const aDiff = Math.abs((a.year || 0) - year);
      const bDiff = Math.abs((b.year || 0) - year);
      return aDiff - bDiff;
    });

    if (imdbResults && imdbResults.length > 0) {
      const yearAttempts = imdbResults
        .filter(result => result.year && result.year !== year)
        .map(async (result) => {
          const fallbackUrl = `https://showbox.media/${type}/${prefix}${formattedTitle}-${result.year}`;
          
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
            return null;
          }
        });

      const results = await Promise.allSettled(yearAttempts);
      const successfulResult = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => r.value)[0];
      
      if (successfulResult) {
        await redisCache.set(cacheKey, successfulResult.id, CACHE_TTL.URL);
        return successfulResult.id;
      }
    }
  } catch (error) {
    // Error in tryUrlBasedId
  }
  
  return null;
}

async function fetchFebboxFiles(shareKey, parentId = 0, customToken = null) {
  const token = customToken || UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
  const allFiles = [];
  let page = 1;
  let hasMorePages = true;
  
  while (hasMorePages) {
    const fileListUrl = `https://www.febbox.com/file/file_share_list?page=${page}&share_key=${shareKey}&pwd=&parent_id=${parentId}`;
    
    const response = await fetch(fileListUrl, {
      headers: {
        'cookie': `ui=${token}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const data = await response.json();
    
    if (!data?.data?.file_list) {
      throw new Error('Failed to fetch Febbox files');
    }
    
    const files = data.data.file_list;
    allFiles.push(...files);
    
    // Check if there are more pages (if we get fewer files than expected, we're done)
    if (files.length === 0 || files.length < 20) { // Assuming 20 files per page
      hasMorePages = false;
    } else {
      page++;
    }
  }
  
  return allFiles;
}

function extractTopQualityStreams(streams) {
  if (!streams) return { primary: null, secondary: null };
  
  if (streams.player_streams && Array.isArray(streams.player_streams)) {
    const qualityOrder = ['original', 'org', '4k', '2160p', '1080p', '720p', '480p', '360p'];
    
    const sortedStreams = [...streams.player_streams].sort((a, b) => {
      const aQuality = (a.quality || '').toLowerCase();
      const bQuality = (b.quality || '').toLowerCase();
      
      if (aQuality.includes('original') || aQuality.includes('org')) return -1;
      if (bQuality.includes('original') || bQuality.includes('org')) return 1;
      
      const aIndex = qualityOrder.findIndex(q => aQuality.includes(q));
      const bIndex = qualityOrder.findIndex(q => bQuality.includes(q));
      
      const aQualityValue = aIndex >= 0 ? aIndex : qualityOrder.length;
      const bQualityValue = bIndex >= 0 ? bIndex : qualityOrder.length;
      
      return aQualityValue - bQualityValue;
    });
    
    return { 
      primary: sortedStreams[0]?.file || null, 
      secondary: sortedStreams[1]?.file || null,
      primaryQuality: sortedStreams[0]?.quality || 'Unknown',
      secondaryQuality: sortedStreams[1]?.quality || 'Unknown'
    };
  }
  
  if (Array.isArray(streams)) {
    if (streams.length > 0 && streams[0] && 'file' in streams[0]) {
      const qualityOrder = ['original', 'org', '4k', '2160p', '1080p', '720p', '480p', '360p'];
      
      const sortedStreams = [...streams].sort((a, b) => {
        const aQuality = (a.quality || '').toLowerCase();
        const bQuality = (b.quality || '').toLowerCase();
        
        if (aQuality.includes('original') || aQuality.includes('org')) return -1;
        if (bQuality.includes('original') || bQuality.includes('org')) return 1;
        
        const aIndex = qualityOrder.findIndex(q => aQuality.includes(q));
        const bIndex = qualityOrder.findIndex(q => bQuality.includes(q));
        
        const aQualityValue = aIndex >= 0 ? aIndex : qualityOrder.length;
        const bQualityValue = bIndex >= 0 ? bIndex : qualityOrder.length;
        
        return aQualityValue - bQualityValue;
      });
      
      return { 
        primary: sortedStreams[0]?.file || null, 
        secondary: sortedStreams[1]?.file || null,
        primaryQuality: sortedStreams[0]?.quality || 'Unknown',
        secondaryQuality: sortedStreams[1]?.quality || 'Unknown'
      };
    }
    
    const filesWithStreams = streams.filter(stream => 
      stream && stream.player_streams && Array.isArray(stream.player_streams)
    );
    
    if (filesWithStreams.length > 0) {
      const qualityResults = filesWithStreams
        .map(stream => extractTopQualityStreams(stream))
        .filter(result => result.primary);
      
      if (qualityResults.length > 0) {
        return qualityResults[0];
      }
    }
  }
  
  return { primary: null, secondary: null };
}



function hasValidStreams(data) {
  if (data.streams) {
    const hasPlayerStreams = data.streams.player_streams && 
                          data.streams.player_streams.length > 0 && 
                          data.streams.player_streams[0].file;
          
    const hasDirectStreams = Array.isArray(data.streams) && 
                           data.streams.length > 0 && 
                           data.streams[0].player_streams && 
                           data.streams[0].player_streams.length > 0;
          
    return hasPlayerStreams || hasDirectStreams;
  }
  
  if (data.seasons) {
    return Object.values(data.seasons).some(episodes => 
      Array.isArray(episodes) && 
      episodes.length > 0 && 
      episodes[0].player_streams && 
      episodes[0].player_streams.length > 0
    );
  }
  
  return false;
}

// Helper function to retry fetching streams for items with empty player_streams
async function retryEmptyStreams(items, userToken, shareKey, maxRetries = 2) {
  const itemsToRetry = items.filter(item => 
    !item.player_streams || item.player_streams.length === 0
  );
  
  if (itemsToRetry.length === 0) return items;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const item of itemsToRetry) {
      if (!item.player_streams || item.player_streams.length === 0) {
        try {
          // Extract FID from direct_download URL if available
          let fid = item.fid;
          if (!fid && item.direct_download) {
            const fidMatch = item.direct_download.match(/fid=([^&]+)/);
            if (fidMatch) {
              fid = fidMatch[1];
            }
          }
          
          if (fid) {
            const retryStreams = await getStreamLinks(fid, userToken, shareKey);
            if (retryStreams && retryStreams.length > 0) {
              item.player_streams = retryStreams;
            }
          }
        } catch (error) {
          // Retry failed for item
        }
      }
    }
    
    // Check if we still have items with empty streams
    const stillEmpty = itemsToRetry.filter(item => 
      !item.player_streams || item.player_streams.length === 0
    );
    
    if (stillEmpty.length === 0) {
      break;
    }
    
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between attempts
    }
  }
  
  return items;
}

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode, token, fastMode } = req.query;
    let showboxId = null;
    let tmdbData = null;
    const userToken = token || null;
    
    // Clean tmdbId - remove any query parameters that might have been included
    const cleanTmdbId = tmdbId.split('&')[0].split('?')[0];
    
    const tokenIdentifier = userToken || 'default';
    const cacheKey = `showbox:${cleanTmdbId}:${type}${season ? `:s${season}` : ''}${episode ? `:e${episode}` : ''}:js:${tokenIdentifier}`;
    
    // Check cache first
    const cachedResult = await redisCache.get(cacheKey);
    if (cachedResult) {
      return res.json({...cachedResult, source: 'cache'});
    }

    try {
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/${type}/${cleanTmdbId}?api_key=${process.env.API_TOKEN}`
      );
      tmdbData = await tmdbResponse.json();
      
      const title = tmdbData.title || tmdbData.name;
      const year = new Date(tmdbData.release_date || tmdbData.first_air_date).getFullYear();
      
      showboxId = await tryUrlBasedId(title, year, type);
      
      if (!showboxId) {
        const searchResult = await searchShowboxByTitle(title, type, year);
        if (!searchResult?.id) {
          throw new Error('Content not found on ShowBox');
        }
        showboxId = searchResult.id;
      }

      const febboxUrl = await getFebboxShareLink(showboxId, type);
      const shareKey = febboxUrl.split('/share/')[1];

      let streamLinks = [];
      const files = await fetchFebboxFiles(shareKey, 0, userToken);
      
      if (type === 'tv') {
        const seasons = {};
        
        // More flexible season folder detection
        const seasonFolders = files.filter(file => {
          if (file.is_dir !== 1) return false;
          const fileName = file.file_name.toLowerCase();
          return fileName.includes('season') || 
                 fileName.includes('s') || 
                 /^\d+$/.test(fileName) || // Just numbers
                 /^season\s*\d+/i.test(fileName) || // Season 1, Season 2, etc.
                 /^s\d+/i.test(fileName); // S1, S2, etc.
        });

        if (season) {
          const targetSeasonFolder = seasonFolders.find(folder => {
            const seasonNum = parseInt(folder.file_name.match(/\d+/)?.[0] || '0', 10);
            return seasonNum === parseInt(season, 10);
          });

          if (targetSeasonFolder) {
            const episodeFiles = await fetchFebboxFiles(shareKey, targetSeasonFolder.fid, userToken);
            
            const seasonEpisodes = await Promise.all(episodeFiles.map(async (episodeFile) => {
              const ext = episodeFile.file_name.split('.').pop().toLowerCase();
              const episodeMatch = episodeFile.file_name.match(/E(\d+)/i);
              const episodeNumber = parseInt(episodeMatch?.[1] || '0', 10);
              
              if (episode && episodeNumber !== parseInt(episode, 10)) {
                return null;
              }

              const qualityMatch = episodeFile.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
              const playerSources = await getStreamLinks(episodeFile.fid, userToken, shareKey);

              return {
                episode: episodeNumber,
                filename: episodeFile.file_name,
                quality: qualityMatch ? qualityMatch[1] : 'Unknown',
                type: ext,
                size: episodeFile.file_size,
                player_streams: playerSources,
                direct_download: `https://www.febbox.com/file/download_share?fid=${episodeFile.fid}&share_key=${shareKey}`,
                fid: episodeFile.fid
              };
            }));

            const filteredEpisodes = seasonEpisodes.filter(e => e !== null);
            
            if (filteredEpisodes.length > 0) {
              // Retry any episodes with empty streams
              const retriedEpisodes = await retryEmptyStreams(filteredEpisodes, userToken, shareKey);
              seasons[parseInt(season, 10)] = retriedEpisodes;
            }
          } else {
            // Fallback: If no season folder found, try to find episodes in root directory
            const videoFiles = files.filter(file => file.is_dir === 0);
            const episodeFiles = videoFiles.filter(file => {
              const fileName = file.file_name.toLowerCase();
              const seasonMatch = fileName.match(/s(\d+)/i);
              return seasonMatch && parseInt(seasonMatch[1]) === parseInt(season, 10);
            });
            
            if (episodeFiles.length > 0) {
              const seasonEpisodes = await Promise.all(episodeFiles.map(async (episodeFile) => {
                const ext = episodeFile.file_name.split('.').pop().toLowerCase();
                const episodeNumber = parseInt(episodeFile.file_name.match(/E(\d+)/i)?.[1] || '0', 10);
                
                if (episode && episodeNumber !== parseInt(episode, 10)) {
                  return null;
                }

                const qualityMatch = episodeFile.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
                const playerSources = await getStreamLinks(episodeFile.fid, userToken, shareKey);

                return {
                  episode: episodeNumber,
                  filename: episodeFile.file_name,
                  quality: qualityMatch ? qualityMatch[1] : 'Unknown',
                  type: ext,
                  size: episodeFile.file_size,
                  player_streams: playerSources,
                  direct_download: `https://www.febbox.com/file/download_share?fid=${episodeFile.fid}&share_key=${shareKey}`,
                  fid: episodeFile.fid
                };
              }));

              const filteredEpisodes = seasonEpisodes.filter(e => e !== null);
              if (filteredEpisodes.length > 0) {
                // Retry any episodes with empty streams
                const retriedEpisodes = await retryEmptyStreams(filteredEpisodes, userToken, shareKey);
                seasons[parseInt(season, 10)] = retriedEpisodes;
              }
            }
          }
        }

        if (season && episode) {
          const targetSeason = seasons[parseInt(season, 10)];
          if (!targetSeason) {
            throw new Error(`Season ${season} not found. Available seasons: ${Object.keys(seasons).join(', ')}`);
          }
          
          const targetEpisode = targetSeason.find(e => e.episode === parseInt(episode, 10));
          if (!targetEpisode) {
            throw new Error('Episode not found');
          }
          
          const responseData = {
            success: true,
            tmdb_id: tmdbId,
            type,
            title,
            year,
            showbox_id: showboxId,
            febbox_url: febboxUrl,
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
            streams: targetEpisode,
            seasons
          };



          if (fastMode && streamLinks.length > 0) {
            return res.json({
              success: true,
              tmdb_id: tmdbId,
              type,
              title,
              fastMode: true,
              streams: streamLinks.slice(0, 1)
            });
          }

          // Final validation and logging
          const hasStreams = hasValidStreams(responseData);
          
          if (hasStreams) {
            await redisCache.set(cacheKey, responseData, CACHE_TTL.SHOWBOX);
          }

          return res.json(responseData);
        }

        // If no season specified but we have season folders, populate all seasons
        if (!season && seasonFolders.length > 0) {
          for (const folder of seasonFolders) {
            const seasonNum = parseInt(folder.file_name.match(/\d+/)?.[0] || '0', 10);
            if (seasonNum > 0) {
              try {
                const episodeFiles = await fetchFebboxFiles(shareKey, folder.fid, userToken);
                const seasonEpisodes = await Promise.all(episodeFiles.map(async (episodeFile) => {
                  const ext = episodeFile.file_name.split('.').pop().toLowerCase();
                  const episodeNumber = parseInt(episodeFile.file_name.match(/E(\d+)/i)?.[1] || '0', 10);
                  const qualityMatch = episodeFile.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
                  const playerSources = await getStreamLinks(episodeFile.fid, userToken, shareKey);

                  return {
                    episode: episodeNumber,
                    filename: episodeFile.file_name,
                    quality: qualityMatch ? qualityMatch[1] : 'Unknown',
                    type: ext,
                    size: episodeFile.file_size,
                    player_streams: playerSources,
                    direct_download: `https://www.febbox.com/file/download_share?fid=${episodeFile.fid}&share_key=${shareKey}`,
                    fid: episodeFile.fid
                  };
                }));

                const filteredEpisodes = seasonEpisodes.filter(e => e !== null);
                if (filteredEpisodes.length > 0) {
                  // Retry any episodes with empty streams
                  const retriedEpisodes = await retryEmptyStreams(filteredEpisodes, userToken, shareKey);
                  seasons[seasonNum] = retriedEpisodes;
                }
              } catch (error) {
                // Error processing season
              }
            }
          }
        }

        const responseData = {
          success: true,
          tmdb_id: tmdbId,
          type,
          title,
          year,
          showbox_id: showboxId,
          febbox_url: febboxUrl,
          seasons
        };



        if (hasValidStreams(responseData)) {
          await redisCache.set(cacheKey, responseData, CACHE_TTL.SHOWBOX);
        }

        return res.json(responseData);
        
      } else {
        // Handle movies
        const videoFiles = files.filter(file => file.is_dir === 0);
        streamLinks = await Promise.all(videoFiles.map(async (file) => {
          const ext = file.file_name.split('.').pop().toLowerCase();
          const qualityMatch = file.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
          const playerSources = await getStreamLinks(file.fid, userToken, shareKey);
          
          return {
            filename: file.file_name,
            quality: qualityMatch ? qualityMatch[1] : 'Unknown',
            type: ext,
            size: file.file_size,
            player_streams: playerSources,
            direct_download: `https://www.febbox.com/file/download_share?fid=${file.fid}&share_key=${shareKey}`,
            fid: file.fid
          };
        }));
        
        // Retry any movies with empty streams
        streamLinks = await retryEmptyStreams(streamLinks, userToken, shareKey);
      }

      // Return results for TV episode
      if (type === 'tv' && season && episode && streamLinks.length > 0) {
        const targetEpisode = streamLinks.find(link => {
          const seasonMatch = link.filename.match(/S(\d+)/i);
          const episodeMatch = link.filename.match(/E(\d+)/i);
          return seasonMatch && episodeMatch && 
                parseInt(seasonMatch[1]) === parseInt(season) &&
                parseInt(episodeMatch[1]) === parseInt(episode);
        });

        if (!targetEpisode) {
          throw new Error('Episode not found');
        }

        const responseData = {
          success: true,
          tmdb_id: tmdbId,
          type,
          title,
          year,
          showbox_id: showboxId,
          febbox_url: febboxUrl,
          season: parseInt(season),
          episode: parseInt(episode),
          streams: targetEpisode
        };



        // Fast mode response
        if (fastMode && streamLinks.length > 0) {
          return res.json({
            success: true,
            tmdb_id: tmdbId,
            type,
            title,
            fastMode: true,
            streams: streamLinks.slice(0, 1)
          });
        }

        if (hasValidStreams(responseData)) {
          await redisCache.set(cacheKey, responseData, CACHE_TTL.SHOWBOX);
        }

        return res.json(responseData);
      }

      // General response for other cases
      const responseData = {
        success: true,
        tmdb_id: tmdbId,
        type,
        title,
        year,
        showbox_id: showboxId,
        febbox_url: febboxUrl,
        streams: streamLinks
      };



      if (hasValidStreams(responseData)) {
        await redisCache.set(cacheKey, responseData, CACHE_TTL.SHOWBOX);
      }

      return res.json(responseData);

    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        showbox_id: showboxId
      });
    }
  },

  async clearCache(req, res) {
    try {
      const cleared = await redisCache.flushAll();
      return res.json({
        success: true,
        message: 'Cache cleared successfully',
        cleared: cleared
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  },
  

};