import NodeCache from 'node-cache';
import _ from 'lodash';
import fetch from 'node-fetch';
import { withProxy } from '../utils/proxy-integration.js';
import sqlite3 from 'sqlite3';
import path from 'path';

// Initialize cache with 48 hour TTL
const cache = new NodeCache({ stdTTL: 48 * 60 * 60 });

// Database connection
let db = null;
const dbPath = path.join(process.cwd(), 'imdb_movies.db');

// Initialize database connection
function initDatabase() {
    if (!db) {
        db = new sqlite3.Database(dbPath);
    }
}

// Torrentio API base URL
const TORRENTIO_BASE_URL = 'https://torrentio.strem.fun/stream/movie';

// Search for movie by title in SQLite database
async function findMovieByTitle(title) {
    initDatabase();
    
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT tconst, title
            FROM movies 
            WHERE title LIKE ?
            ORDER BY 
                CASE 
                    WHEN title = ? THEN 1
                    WHEN title LIKE ? THEN 2
                    ELSE 3
                END,
                title ASC
            LIMIT 1
        `;
        
        const exactMatch = title;
        const startsWith = `${title}%`;
        const contains = `%${title}%`;
        
        db.get(sql, [contains, exactMatch, startsWith], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// Fetch quality info directly from Torrentio API
async function fetchQualityInfoFromTorrentio(imdbId) {
    const cacheKey = `torrentio-${imdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `${TORRENTIO_BASE_URL}/${imdbId}.json`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        console.log(`Fetching quality info from Torrentio for IMDB ID: ${imdbId}`);
        const response = await fetch(url, { 
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Torrentio API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.streams || data.streams.length === 0) {
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

        const result = { qualities, mostCommon, bestQuality, allQualities };
        
        // Cache the result
        cache.set(cacheKey, result);
        return result;
        
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


export const qualityController = {
    async getQualityInfo(req, res) {
        const { title } = req.query;
        
        if (!title) {
            return res.status(400).json({ error: 'Title parameter is required' });
        }

        try {
            // Search for movie in SQLite database
            const movie = await findMovieByTitle(title);
            
            if (!movie) {
                return res.status(404).json({ 
                    error: 'Movie not found in database',
                    searchedTitle: title
                });
            }

            console.log(`Found movie: ${movie.title} (${movie.tconst})`);

            // Check cache first
            const cacheKey = `imdb-${movie.tconst}`;
            const cached = cache.get(cacheKey);
            
            if (cached) {
                console.log('Returning cached result');
                res.set('Cache-Control', 'public, max-age=172800'); // 48 hours
                return res.json({
                    [movie.tconst]: cached,
                    movieInfo: {
                        tconst: movie.tconst,
                        title: movie.title
                    }
                });
            }

            // Fetch quality info from Torrentio API
            const qualityInfo = await fetchQualityInfoFromTorrentio(movie.tconst);
            
            if (qualityInfo.error) {
                return res.status(500).json({ 
                    error: qualityInfo.error,
                    movieInfo: {
                        tconst: movie.tconst,
                        title: movie.title
                    }
                });
            }

            // Cache the result
            cache.set(cacheKey, qualityInfo);

            const stats = cache.getStats();
            console.log('Cache stats:', stats);

            // Add cache headers
            res.set('Cache-Control', 'public, max-age=172800'); // 48 hours in seconds
            res.json({
                [movie.tconst]: qualityInfo,
                movieInfo: {
                    tconst: movie.tconst,
                    title: movie.title
                }
            });
            
        } catch (error) {
            console.error('Error in quality controller:', error);
            res.status(500).json({ error: error.message });
        }
    }
};