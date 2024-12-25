import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';

const cache = new NodeCache({ stdTTL: 12 * 60 * 60, checkperiod: 60 * 60 });
const TMDB_API_KEY = 'd3383b7991d02ed3b3842be70307705b';
const CACHE_FILE = path.join(process.cwd(), 'cache', 'quality-cache.json');
const TIMEOUT = 5000;

const initCache = async () => {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    const savedCache = JSON.parse(data);
    Object.entries(savedCache).forEach(([key, value]) => {
      cache.set(key, { ...value.data, lastChecked: Date.now() });
    });
  } catch (error) {
    console.log('Starting fresh cache');
  }
};

const saveCache = async () => {
  try {
    const cacheData = {};
    cache.keys().forEach(key => {
      const data = cache.get(key);
      cacheData[key] = { data, lastChecked: data.lastChecked };
    });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Cache save error:', error);
  }
};

process.on('SIGINT', async () => {
  await saveCache();
  process.exit();
});

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Request timeout');
    throw error;
  }
};

const convertTmdbToImdb = async (tmdbId) => {
  const data = await fetchWithTimeout(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`
  );
  const imdbId = data.external_ids?.imdb_id;
  if (!imdbId) throw new Error('IMDb ID not found');
  return imdbId;
};

const extractQualityType = (name) => {
  const str = name.toUpperCase();
  if (str.includes('2160P') || str.includes('4K') || str.includes('UHD')) return '4K';
  if (str.includes('1080P') || str.includes('FULLHD')) return '1080p';
  if (str.includes('720P') || str.includes('HD')) return '720p';
  if (str.includes('480P') || str.includes('SD')) return '480p';
  if (str.includes('CAM') || str.includes('TS')) return 'CAM';
  if (str.includes('BLURAY') || str.includes('BLU-RAY')) return 'BluRay';
  if (str.includes('WEBDL') || str.includes('WEB-DL') || str.includes('WEB')) return 'WebDL';
  if (str.includes('DVDRIP') || str.includes('DVD')) return 'DVD';
  if (str.includes('HDTV')) return 'HDTV';
  if (str.includes('PDTV')) return 'PDTV';
  return 'Other';
};

const determineBestQuality = (qualities) => {
  const order = ['4K', '1080p', '720p', '480p', 'BluRay', 'WebDL', 'HDTV', 'DVD', 'PDTV', 'CAM', 'Other'];
  return order.find(q => qualities.includes(q)) || qualities[0] || null;
};

const fetchQualityInfo = async (imdbId) => {
  try {
    const data = await fetchWithTimeout(`https://torrentio.strem.fun/stream/movie/${imdbId}.json`);
    if (!data.streams?.length) {
      return { qualities: [], mostCommon: null, bestQuality: null, allQualities: [] };
    }

    const qualityCounts = new Map();
    const allQualities = [];
    
    data.streams.forEach(stream => {
      const quality = extractQualityType(stream.name);
      qualityCounts.set(quality, (qualityCounts.get(quality) || 0) + 1);
      allQualities.push({ quality, name: stream.name });
    });

    const qualities = Array.from(qualityCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .map(([quality]) => quality);

    return {
      qualities,
      mostCommon: qualities[0],
      bestQuality: determineBestQuality(qualities),
      allQualities
    };
  } catch (error) {
    return { error: error.message };
  }
};

export const qualityController = {
  async getQualityInfo(req, res) {
    const { imdb_ids, tmdb_ids } = req.query;
    if (!imdb_ids && !tmdb_ids) {
      return res.status(400).json({ error: 'Missing IDs' });
    }

    try {
      const results = {};
      const processId = async (id, type) => {
        const cacheKey = `${type}-${id}`;
        let data = cache.get(cacheKey);
        
        if (!data) {
          data = type === 'imdb' 
            ? await fetchQualityInfo(id)
            : await fetchQualityInfo(await convertTmdbToImdb(id));
          
          if (!data.error) {
            cache.set(cacheKey, { ...data, lastChecked: Date.now() });
          }
        }
        return data;
      };

      await Promise.all([
        ...(imdb_ids?.split(',').map(id => processId(id, 'imdb')) || []),
        ...(tmdb_ids?.split(',').map(id => processId(id, 'tmdb')) || [])
      ]).then(responses => {
        const ids = [...(imdb_ids?.split(',') || []), ...(tmdb_ids?.split(',') || [])];
        ids.forEach((id, index) => {
          results[id] = responses[index];
        });
      });

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

initCache();