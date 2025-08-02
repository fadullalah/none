import _ from 'lodash';
import fetch from 'node-fetch';
import { withProxy } from '../utils/proxy-integration.js';

// Redis configuration for quality controller
const REDIS_URL = process.env.UPSTASH_QUALITY_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_QUALITY_REDIS_REST_TOKEN;

// Cache TTL values (reduced for cost-effectiveness)
const CACHE_TTL = {
  TMDB_CONVERT: 86400, // 24 hours
  IMDB_QUALITY: 3600, // 1 hour
  WORKER_RESULTS: 1800 // 30 minutes
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

const TMDB_API_KEY = 'd3383b7991d02ed3b3842be70307705b';

// Define workers
const WORKERS = [
    'https://q-s.nunflix-info.workers.dev',
    'https://q1.xaxipe5682.workers.dev',
    'https://q-s2.sofefor785.workers.dev',
    'https://q-s3.hivili6726.workers.dev',
    'https://q-s4.skilled-raccoon-kcso.workers.dev',
    'https://q-s5.meaningful-catshark-gqpm.workers.dev',
    'https://q-s6.wee-skink-xikl.workers.dev',
    'https://q-s8.stuck-giraffe-ltth.workers.dev',
    'https://q-s9.semantic-possum-zrru.workers.dev',
    'https://q-s10.accessible-sole-vjmz.workers.dev',
    'https://q-s11.vicarious-chickadee-apnp.workers.dev',
    'https://q-s12.cuddly-vulture-veje.workers.dev',
    'https://q-s13.disappointed-ladybug-bdlb.workers.dev',
    'https://q-s14.javap81774.workers.dev',
    'https://q-s15.causal-dragon-upft.workers.dev',
    'https://a.confused-sloth-iiat.workers.dev',
    'https://b.moral-lobster-xxhs.workers.dev',
    'https://c.frozen-cattle-xvmi.workers.dev',
    'https://d.homely-vulture-lopr.workers.dev'
];

const workerHealth = new Map(WORKERS.map(worker => [worker, { 
    isHealthy: true,
    failCount: 0,
    lastCheck: Date.now() 
}]));

let currentWorkerIndex = 0;

// Convert TMDB ID to IMDB ID
async function convertTmdbToImdb(tmdbId) {
    const cacheKey = `tmdb-convert-${tmdbId}`;
    const cached = await redisCache.get(cacheKey);
    if (cached) return cached;

    try {
        const response = await withProxy(config => 
            fetch(
                `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`,
                config
            )
        );

        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        const data = await response.json();
        const imdbId = data.external_ids?.imdb_id;

        if (!imdbId) {
            throw new Error('No IMDB ID found');
        }

        // Cache the conversion
        await redisCache.set(cacheKey, imdbId, CACHE_TTL.TMDB_CONVERT);
        return imdbId;
    } catch (error) {
        console.error(`TMDB conversion error for ID ${tmdbId}:`, error);
        throw error;
    }
}

function getNextHealthyWorker() {
    const startIndex = currentWorkerIndex;
    const now = Date.now();

    do {
        const worker = WORKERS[currentWorkerIndex];
        const health = workerHealth.get(worker);
        
        if (!health.isHealthy && now - health.lastCheck > 5 * 60 * 1000) {
            health.isHealthy = true;
            health.failCount = 0;
        }

        if (health.isHealthy) {
            currentWorkerIndex = (currentWorkerIndex + 1) % WORKERS.length;
            return worker;
        }

        currentWorkerIndex = (currentWorkerIndex + 1) % WORKERS.length;
    } while (currentWorkerIndex !== startIndex);

    WORKERS.forEach(worker => {
        const health = workerHealth.get(worker);
        health.isHealthy = true;
        health.failCount = 0;
        health.lastCheck = now;
    });

    return WORKERS[0];
}

async function fetchFromWorker(worker, imdbIds) {
    const params = new URLSearchParams();
    params.set('imdb_ids', imdbIds.join(','));
    
    try {
        console.log(`Fetching from worker ${worker} with IDs:`, imdbIds);
        const response = await fetch(`${worker}/?${params}`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Worker responded with ${response.status}`);
        }
        
        const data = await response.json();
        
        const health = workerHealth.get(worker);
        health.isHealthy = true;
        health.failCount = 0;
        health.lastCheck = Date.now();
        
        return data;
    } catch (error) {
        console.error(`Worker ${worker} failed:`, error);
        
        const health = workerHealth.get(worker);
        health.failCount += 1;
        health.lastCheck = Date.now();
        
        if (health.failCount >= 3) {
            health.isHealthy = false;
        }
        
        return null;
    }
}

// Direct implementation of quality detection logic as fallback
async function fetchQualityInfoDirect(imdbId) {
    try {
        const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await withProxy(config => 
            fetch(url, { 
                ...config,
                signal: controller.signal 
            })
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Torrentio API error: ${response.status} ${response.statusText}`);
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

        const qualities = Object.keys(qualityCounts).sort((a, b) => qualityCounts[b] - qualityCounts[a]);
        const mostCommon = qualities[0];
        const bestQuality = determineBestQuality(qualities);

        return { qualities, mostCommon, bestQuality, allQualities };
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Torrentio API request timed out for IMDB ID ${imdbId}`);
            return { error: 'Request timed out' };
        }
        console.error(`Error fetching quality info for IMDB ID ${imdbId}:`, error);
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

// Check if worker response indicates a limit error
function isLimitError(data) {
    if (!data) return false;
    
    // Check if any of the entries have a limit error
    return Object.values(data).some(item => 
        item && item.error && (
            item.error.includes('limit exceeded') || 
            item.error.includes('KV get() limit') ||
            item.error.includes('rate limit')
        )
    );
}

export const qualityController = {
    async getQualityInfo(req, res) {
        const { imdb_ids, tmdb_ids } = req.query;
        
        if (!imdb_ids && !tmdb_ids) {
            return res.status(400).json({ error: 'Missing IDs' });
        }

        try {
            const results = {};
            let allImdbIds = [];
            
            // Process IMDB IDs
            if (imdb_ids) {
                allImdbIds.push(...imdb_ids.split(','));
            }
            
            // Convert TMDB IDs to IMDB IDs
            if (tmdb_ids) {
                const ids = tmdb_ids.split(',');
                for (const tmdbId of ids) {
                    try {
                        const imdbId = await convertTmdbToImdb(tmdbId);
                        allImdbIds.push(imdbId);
                        // Store the mapping for later
                        results[tmdbId] = { pending: imdbId };
                    } catch (error) {
                        console.error(`Failed to convert TMDB ID ${tmdbId}:`, error);
                        results[tmdbId] = { error: 'TMDB conversion failed' };
                    }
                }
            }

            // Remove duplicates
            allImdbIds = [...new Set(allImdbIds)];
            
            // Check cache for all IMDB IDs
            const uncachedIds = [];
            for (const id of allImdbIds) {
                const cached = await redisCache.get(`imdb-${id}`);
                if (cached) {
                    results[id] = cached;
                } else {
                    uncachedIds.push(id);
                }
            }
            
            // Fetch uncached IDs
            if (uncachedIds.length > 0) {
                const worker = getNextHealthyWorker();
                console.log(`Using worker ${worker} for IDs:`, uncachedIds);
                
                const workerResults = await fetchFromWorker(worker, uncachedIds);
                
                // Check if we hit a limit error
                if (workerResults && isLimitError(workerResults)) {
                    console.log('Worker limit exceeded, falling back to direct implementation');
                    
                    // Use direct implementation for each ID
                    for (const id of uncachedIds) {
                        console.log(`Fetching directly for ID: ${id}`);
                        const directResult = await fetchQualityInfoDirect(id);
                        if (!directResult.error) {
                            results[id] = directResult;
                            await redisCache.set(`imdb-${id}`, directResult, CACHE_TTL.IMDB_QUALITY);
                        } else {
                            results[id] = { error: directResult.error };
                        }
                    }
                } else if (workerResults) {
                    // Process normal worker results
                    for (const [id, data] of Object.entries(workerResults)) {
                        if (!data.error) {
                            results[id] = data;
                            await redisCache.set(`imdb-${id}`, data, CACHE_TTL.IMDB_QUALITY);
                        } else {
                            results[id] = data;
                        }
                    }
                } else {
                    // Worker completely failed, use direct implementation
                    console.log('Worker failed, falling back to direct implementation');
                    for (const id of uncachedIds) {
                        console.log(`Fetching directly for ID: ${id}`);
                        const directResult = await fetchQualityInfoDirect(id);
                        if (!directResult.error) {
                            results[id] = directResult;
                            await redisCache.set(`imdb-${id}`, directResult, CACHE_TTL.IMDB_QUALITY);
                        } else {
                            results[id] = { error: directResult.error };
                        }
                    }
                }
            }

            // Map back TMDB results
            if (tmdb_ids) {
                const tmdbResults = {};
                tmdb_ids.split(',').forEach(tmdbId => {
                    const mapping = results[tmdbId];
                    if (mapping?.pending) {
                        tmdbResults[tmdbId] = results[mapping.pending];
                    } else {
                        tmdbResults[tmdbId] = mapping;
                    }
                });
                
                // Replace results with TMDB mapping if only TMDB IDs were requested
                if (!imdb_ids) {
                    Object.assign(results, tmdbResults);
                }
            }

            console.log('Quality cache operations completed');

            res.json(results);
        } catch (error) {
            console.error('Error in quality controller:', error);
            res.status(500).json({ error: error.message });
        }
    }
};