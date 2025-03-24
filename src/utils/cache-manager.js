import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../cache');
const SUBTITLE_SEARCH_CACHE_DIR = path.join(CACHE_DIR, 'subtitle-searches');
const SUBTITLE_CONTENT_CACHE_DIR = path.join(CACHE_DIR, 'subtitle-contents');

// Cache durations in milliseconds
const CACHE_DURATIONS = {
  SUBTITLE_SEARCH: 7 * 24 * 60 * 60 * 1000, // 7 days
  SUBTITLE_CONTENT: 30 * 24 * 60 * 60 * 1000 // 30 days
};

// Create necessary directories
async function ensureCacheDirs() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.mkdir(SUBTITLE_SEARCH_CACHE_DIR, { recursive: true });
    await fs.mkdir(SUBTITLE_CONTENT_CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating cache directories:', error);
  }
}

// Initialize cache directories
ensureCacheDirs();

// Generate a cache key from parameters
function generateCacheKey(params) {
  return Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

// Save data to cache
async function saveToCache(cacheDir, key, data) {
  try {
    const filePath = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        timestamp: Date.now(),
        data
      })
    );
    console.log(`Cached data at: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error saving to cache: ${error.message}`);
    return false;
  }
}

// Get data from cache if not expired
async function getFromCache(cacheDir, key, maxAge) {
  try {
    const filePath = path.join(cacheDir, `${key}.json`);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const cacheData = JSON.parse(fileContent);
    
    const now = Date.now();
    const age = now - cacheData.timestamp;
    
    if (age < maxAge) {
      console.log(`Cache hit for key: ${key}, age: ${(age / 1000 / 60).toFixed(2)} minutes`);
      return cacheData.data;
    }
    
    console.log(`Cache expired for key: ${key}, age: ${(age / 1000 / 60 / 60).toFixed(2)} hours`);
    return null;
  } catch (error) {
    // File doesn't exist or other error
    console.log(`Cache miss for key: ${key}: ${error.message}`);
    return null;
  }
}

// Clear specific cache directory
async function clearCache(cacheDir) {
  try {
    const files = await fs.readdir(cacheDir);
    
    for (const file of files) {
      await fs.unlink(path.join(cacheDir, file));
    }
    
    console.log(`Cleared cache in ${cacheDir}`);
    return true;
  } catch (error) {
    console.error(`Error clearing cache: ${error.message}`);
    return false;
  }
}

export const subtitleCache = {
  // Cache subtitle search results
  async cacheSearch(params, results) {
    const key = generateCacheKey(params);
    return await saveToCache(SUBTITLE_SEARCH_CACHE_DIR, key, results);
  },
  
  // Get cached subtitle search results
  async getSearch(params) {
    const key = generateCacheKey(params);
    return await getFromCache(SUBTITLE_SEARCH_CACHE_DIR, key, CACHE_DURATIONS.SUBTITLE_SEARCH);
  },
  
  // Cache downloaded subtitle content
  async cacheSubtitleContent(fileId, subtitleData) {
    return await saveToCache(SUBTITLE_CONTENT_CACHE_DIR, fileId.toString(), subtitleData);
  },
  
  // Get cached subtitle content
  async getSubtitleContent(fileId) {
    return await getFromCache(SUBTITLE_CONTENT_CACHE_DIR, fileId.toString(), CACHE_DURATIONS.SUBTITLE_CONTENT);
  },
  
  // Clear all subtitle search caches
  async clearSearchCache() {
    return await clearCache(SUBTITLE_SEARCH_CACHE_DIR);
  },
  
  // Clear all subtitle content caches
  async clearContentCache() {
    return await clearCache(SUBTITLE_CONTENT_CACHE_DIR);
  },
  
  // Clear all subtitle caches
  async clearAllCaches() {
    const searchCleared = await this.clearSearchCache();
    const contentCleared = await this.clearContentCache();
    return searchCleared && contentCleared;
  }
}; 