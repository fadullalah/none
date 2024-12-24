import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';

// Cache configuration
const cache = new NodeCache({
 stdTTL: 12 * 60 * 60, // 12 hours TTL
 checkperiod: 60 * 60, // Check every hour
 useClones: false
});

const TMDB_API_KEY = 'd3383b7991d02ed3b3842be70307705b';
const CACHE_FILE = path.join(process.cwd(), 'cache', 'quality-cache.json');
const UPDATE_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

let pendingSaves = new Set(); // Track new entries waiting to be saved
let saveCacheTimeout = null; // Timer for batched saves

// Load cache from disk
async function loadCacheFromDisk() {
 try {
   await fs.mkdir(path.join(process.cwd(), 'cache'), { recursive: true });
   const data = await fs.readFile(CACHE_FILE, 'utf8');
   const savedCache = JSON.parse(data);
   
   for (const [key, value] of Object.entries(savedCache)) {
     cache.set(key, {
       ...value.data,
       lastChecked: value.lastChecked || Date.now(),
       lastUpdated: value.lastUpdated || Date.now()
     });
   }
   console.log(`Quality cache loaded with ${Object.keys(savedCache).length} entries`);
 } catch (error) {
   console.log('Starting with fresh quality cache');
 }
}

// Batch save to disk
async function batchSaveToDisk() {
 if (pendingSaves.size === 0) return;
 
 try {
   const cacheData = {};
   const keys = cache.keys();
   
   keys.forEach(key => {
     const data = cache.get(key);
     cacheData[key] = {
       data,
       lastChecked: data.lastChecked,
       lastUpdated: data.lastUpdated
     };
   });
   
   await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
   console.log(`Batch saved ${pendingSaves.size} new entries. Total cache size: ${keys.length}`);
   pendingSaves.clear();
 } catch (error) {
   console.error('Error batch saving cache:', error);
 }
}

// Debounced save function
function debouncedSave() {
 if (saveCacheTimeout) {
   clearTimeout(saveCacheTimeout);
 }
 saveCacheTimeout = setTimeout(batchSaveToDisk, 5000); // Wait 5 seconds to batch saves
}

// Update cached qualities
async function updateCachedQualities() {
 console.log('Starting cache update check...');
 const now = Date.now();
 const keys = cache.keys();
 let updatedCount = 0;
 let needsSave = false;

 for (const key of keys) {
   const cachedData = cache.get(key);
   
   if (now - cachedData.lastChecked >= UPDATE_INTERVAL) {
     try {
       const [type, id] = key.split('-');
       let newData;

       if (type === 'imdb') {
         newData = await fetchQualityInfo(id);
       } else if (type === 'tmdb') {
         const imdbId = await convertTmdbToImdb(id);
         newData = await fetchQualityInfo(imdbId);
       }

       if (!newData.error && JSON.stringify(newData) !== JSON.stringify(cachedData)) {
         cache.set(key, {
           ...newData,
           lastChecked: now,
           lastUpdated: now
         });
         updatedCount++;
         needsSave = true;
         console.log(`Updated: ${key}`);
       } else {
         cache.set(key, {
           ...cachedData,
           lastChecked: now
         });
       }
     } catch (error) {
       console.error(`Update failed for ${key}:`, error);
     }
   }
 }

 console.log(`Update completed. Updated ${updatedCount} entries`);
 if (needsSave) {
   await batchSaveToDisk();
 }
}

// Initialize periodic tasks
setInterval(updateCachedQualities, UPDATE_INTERVAL);

// Handle shutdown
process.on('SIGINT', async () => {
 console.log('Saving cache before shutdown...');
 await batchSaveToDisk();
 process.exit();
});

// Load initial cache
loadCacheFromDisk();

async function convertTmdbToImdb(tmdbId) {
 const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
 
 try {
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 5000);

   const response = await fetch(url, { signal: controller.signal });
   clearTimeout(timeout);

   if (!response.ok) {
     throw new Error(`TMDb API error: ${response.status}`);
   }
   
   const data = await response.json();
   const imdbId = data.external_ids?.imdb_id;
   
   if (!imdbId) {
     throw new Error('IMDb ID not found');
   }
   
   return imdbId;
 } catch (error) {
   if (error.name === 'AbortError') {
     throw new Error('TMDb API timeout');
   }
   throw error;
 }
}

async function fetchQualityInfo(imdbId) {
 const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
 
 try {
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 5000);

   const response = await fetch(url, { signal: controller.signal });
   clearTimeout(timeout);

   if (!response.ok) {
     throw new Error(`Torrentio API error: ${response.status}`);
   }

   const data = await response.json();
   if (!data.streams) {
     return { qualities: [], mostCommon: null, bestQuality: null, allQualities: [] };
   }

   const qualityCounts = {};
   const allQualities = [];
   
   data.streams.forEach(stream => {
     const quality = extractQualityType(stream.name);
     qualityCounts[quality] = (qualityCounts[quality] || 0) + 1;
     allQualities.push({ quality, name: stream.name });
   });

   const qualities = Object.keys(qualityCounts)
     .sort((a, b) => qualityCounts[b] - qualityCounts[a]);
     
   const mostCommon = qualities[0];
   const bestQuality = determineBestQuality(qualities);

   return { qualities, mostCommon, bestQuality, allQualities };
 } catch (error) {
   if (error.name === 'AbortError') {
     return { error: 'Request timeout' };
   }
   return { error: error.message };
 }
}

function extractQualityType(qualityString) {
 const upperCaseString = qualityString.toUpperCase();

 if (upperCaseString.includes('2160P') || upperCaseString.includes('4K') || upperCaseString.includes('UHD')) {
   return '4K';
 } else if (upperCaseString.includes('1080P') || upperCaseString.includes('FULLHD')) {
   return '1080p';
 } else if (upperCaseString.includes('720P') || upperCaseString.includes('HD')) {
   return '720p';
 } else if (upperCaseString.includes('480P') || upperCaseString.includes('SD')) {
   return '480p';
 } else if (upperCaseString.includes('CAM') || upperCaseString.includes('TS') || upperCaseString.includes('TELESYNC')) {
   return 'CAM';
 } else if (upperCaseString.includes('BLURAY') || upperCaseString.includes('BLU-RAY') || upperCaseString.includes('BRRIP')) {
   return 'BluRay';
 } else if (upperCaseString.includes('WEBDL') || upperCaseString.includes('WEB-DL') || upperCaseString.includes('WEB')) {
   return 'WebDL';
 } else if (upperCaseString.includes('DVDRIP') || upperCaseString.includes('DVD')) {
   return 'DVD';
 } else if (upperCaseString.includes('HDTV')) {
   return 'HDTV';
 } else if (upperCaseString.includes('PDTV')) {
   return 'PDTV';
 } else {
   return 'Other';
 }
}

function determineBestQuality(qualities) {
 const qualityOrder = ['4K', '1080p', '720p', '480p', 'BluRay', 'WebDL', 'HDTV', 'DVD', 'PDTV', 'CAM', 'Other'];
 for (let quality of qualityOrder) {
   if (qualities.includes(quality)) {
     return quality;
   }
 }
 return qualities[0] || null;
}

export const qualityController = {
 async getQualityInfo(req, res) {
   const { imdb_ids, tmdb_ids } = req.query;

   if (!imdb_ids && !tmdb_ids) {
     return res.status(400).json({ error: 'Missing imdb_ids or tmdb_ids parameter' });
   }

   try {
     const results = {};
     let newEntries = false;
     
     if (imdb_ids) {
       const ids = imdb_ids.split(',');
       for (const id of ids) {
         const cacheKey = `imdb-${id}`;
         let data = cache.get(cacheKey);
         
         if (!data) {
           data = await fetchQualityInfo(id);
           if (!data.error) {
             cache.set(cacheKey, {
               ...data,
               lastChecked: Date.now(),
               lastUpdated: Date.now()
             });
             pendingSaves.add(cacheKey);
             newEntries = true;
           }
         }
         results[id] = data;
       }
     }
     
     if (tmdb_ids) {
       const ids = tmdb_ids.split(',');
       for (const id of ids) {
         const cacheKey = `tmdb-${id}`;
         let data = cache.get(cacheKey);
         
         if (!data) {
           try {
             const imdbId = await convertTmdbToImdb(id);
             data = await fetchQualityInfo(imdbId);
             if (!data.error) {
               cache.set(cacheKey, {
                 ...data,
                 lastChecked: Date.now(),
                 lastUpdated: Date.now()
               });
               pendingSaves.add(cacheKey);
               newEntries = true;
             }
           } catch (error) {
             console.error(`Error processing TMDB ID ${id}:`, error);
             data = { error: error.message };
           }
         }
         results[id] = data;
       }
     }

     if (newEntries) {
       debouncedSave();
     }

     res.json(results);
   } catch (error) {
     console.error('Global error:', error);
     res.status(500).json({ error: error.message });
   }
 }
};