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

// TMDB API keys for fallback search
const TMDB_API_KEYS = [
    'fb7bb23f03b6994dafc674c074d01761',
    'e55425032d3d0f371fc776f302e7c09b',
    '8301a21598f8b45668d5711a814f01f6',
    '8cf43ad9c085135b9479ad5cf6bbcbda',
    'da63548086e399ffc910fbc08526df05',
    '13e53ff644a8bd4ba37b3e1044ad24f3',
    '269890f657dddf4635473cf4cf456576',
    'a2f888b27315e62e471b2d587048f32e',
    '8476a7ab80ad76f0936744df0430e67c',
    '5622cafbfe8f8cfe358a29c53e19bba0',
    'ae4bd1b6fce2a5648671bfc171d15ba4',
    '257654f35e3dff105574f97fb4b97035',
    '2f4038e83265214a0dcd6ec2eb3276f5',
    '9e43f45f94705cc8e1d5a0400d19a7b7',
    'af6887753365e14160254ac7f4345dd2',
    '06f10fc8741a672af455421c239a1ffc',
    '09ad8ace66eec34302943272db0e8d2c'
];

// TMDB API base URL with CORS proxy
const TMDB_BASE_URL = 'https://api.allorigins.win/raw?url=https://api.themoviedb.org/3';

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

// Get random TMDB API key
function getRandomTmdbApiKey() {
    return TMDB_API_KEYS[Math.floor(Math.random() * TMDB_API_KEYS.length)];
}

// Search for movie using TMDB API
async function searchMovieByTitleTmdb(title) {
    const apiKey = getRandomTmdbApiKey();
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}&page=1`;
    
    try {
        console.log(`Searching TMDB for: ${title}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

        const response = await fetch(searchUrl, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.results || data.results.length === 0) {
            return null;
        }

        // Return the first result (most relevant)
        const movie = data.results[0];
        return {
            tmdb_id: movie.id,
            title: movie.title,
            release_date: movie.release_date,
            overview: movie.overview,
            poster_path: movie.poster_path,
            backdrop_path: movie.backdrop_path
        };
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`TMDB search request timed out for: ${title}`);
            return null;
        }
        console.error(`Error searching TMDB for ${title}:`, error);
        return null;
    }
}

// Get movie details from TMDB API to extract IMDb ID
async function getMovieDetailsFromTmdb(tmdbId) {
    const apiKey = getRandomTmdbApiKey();
    const detailsUrl = `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${apiKey}`;
    
    try {
        console.log(`Fetching TMDB details for ID: ${tmdbId}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

        const response = await fetch(detailsUrl, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.imdb_id) {
            console.log(`No IMDb ID found for TMDB ID: ${tmdbId}`);
            return null;
        }

        return {
            imdb_id: data.imdb_id,
            title: data.title,
            release_date: data.release_date,
            overview: data.overview,
            poster_path: data.poster_path,
            backdrop_path: data.backdrop_path
        };
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`TMDB details request timed out for ID: ${tmdbId}`);
            return null;
        }
        console.error(`Error fetching TMDB details for ID ${tmdbId}:`, error);
        return null;
    }
}


export const qualityController = {
    async getQualityInfo(req, res) {
        const { title, tmdb_ids } = req.query;
        
        // Handle direct TMDB ID lookup (single or multiple)
        if (tmdb_ids) {
            try {
                // Parse TMDB IDs - support both single ID and comma-separated multiple IDs
                const tmdbIdStrings = tmdb_ids.split(',').map(id => id.trim());
                const tmdbIds = tmdbIdStrings.map(id => parseInt(id)).filter(id => !isNaN(id));
                
                if (tmdbIds.length === 0) {
                    return res.status(400).json({ error: 'Invalid TMDB ID format. Provide valid comma-separated IDs.' });
                }

                console.log(`Direct TMDB lookup for IDs: ${tmdbIds.join(', ')}`);

                // Process multiple TMDB IDs
                const results = {};
                const movieInfos = [];
                const errors = [];

                // Process each TMDB ID
                for (const tmdbId of tmdbIds) {
                    try {
                        // Get movie details from TMDB to extract IMDb ID
                        const movieDetails = await getMovieDetailsFromTmdb(tmdbId);
                        
                        if (!movieDetails) {
                            errors.push({
                                tmdbId: tmdbId,
                                error: 'Movie not found in TMDB or no IMDb ID available'
                            });
                            continue;
                        }

                        console.log(`Found movie via TMDB: ${movieDetails.title} (${movieDetails.imdb_id})`);

                        // Check cache first
                        const cacheKey = `imdb-${movieDetails.imdb_id}`;
                        const cached = cache.get(cacheKey);
                        
                        if (cached) {
                            console.log(`Returning cached result for TMDB ID: ${tmdbId}`);
                            results[movieDetails.imdb_id] = cached;
                            movieInfos.push({
                                tconst: movieDetails.imdb_id,
                                title: movieDetails.title,
                                tmdb_id: tmdbId,
                                source: 'tmdb'
                            });
                            continue;
                        }

                        // Fetch quality info from Torrentio API
                        const qualityInfo = await fetchQualityInfoFromTorrentio(movieDetails.imdb_id);
                        
                        if (qualityInfo.error) {
                            errors.push({
                                tmdbId: tmdbId,
                                imdbId: movieDetails.imdb_id,
                                title: movieDetails.title,
                                error: qualityInfo.error
                            });
                            continue;
                        }

                        // Cache the result
                        cache.set(cacheKey, qualityInfo);
                        
                        // Add to results
                        results[movieDetails.imdb_id] = qualityInfo;
                        movieInfos.push({
                            tconst: movieDetails.imdb_id,
                            title: movieDetails.title,
                            tmdb_id: tmdbId,
                            source: 'tmdb'
                        });

                    } catch (error) {
                        console.error(`Error processing TMDB ID ${tmdbId}:`, error);
                        errors.push({
                            tmdbId: tmdbId,
                            error: error.message
                        });
                    }
                }

                // Prepare response
                const response = {
                    results: results,
                    movieInfos: movieInfos,
                    summary: {
                        totalRequested: tmdbIds.length,
                        successful: movieInfos.length,
                        failed: errors.length
                    }
                };

                // Add errors if any
                if (errors.length > 0) {
                    response.errors = errors;
                }

                // Set appropriate status code
                const statusCode = movieInfos.length > 0 ? 200 : 404;
                
                // Add cache headers
                res.set('Cache-Control', 'public, max-age=172800'); // 48 hours in seconds
                res.status(statusCode).json(response);
                
            } catch (error) {
                console.error('Error in TMDB quality controller:', error);
                res.status(500).json({ error: error.message });
            }
            return;
        }

        // Handle title-based search with fallback (single or multiple)
        if (!title) {
            return res.status(400).json({ error: 'Title parameter is required' });
        }

        try {
            // Parse titles - support both single title and comma-separated multiple titles
            const titleStrings = title.split(',').map(t => t.trim()).filter(t => t.length > 0);
            
            if (titleStrings.length === 0) {
                return res.status(400).json({ error: 'Invalid title format. Provide valid comma-separated titles.' });
            }

            console.log(`Title search for: ${titleStrings.join(', ')}`);

            // Process multiple titles
            const results = {};
            const movieInfos = [];
            const errors = [];

            // Process each title
            for (const searchTitle of titleStrings) {
                try {
                    // First, search for movie in SQLite database
                    const movie = await findMovieByTitle(searchTitle);
                    
                    if (movie) {
                        console.log(`Found movie in database: ${movie.title} (${movie.tconst})`);

                        // Check cache first
                        const cacheKey = `imdb-${movie.tconst}`;
                        const cached = cache.get(cacheKey);
                        
                        if (cached) {
                            console.log(`Returning cached result for: ${searchTitle}`);
                            results[movie.tconst] = cached;
                            movieInfos.push({
                                tconst: movie.tconst,
                                title: movie.title,
                                searchedTitle: searchTitle,
                                source: 'database'
                            });
                            continue;
                        }

                        // Fetch quality info from Torrentio API
                        const qualityInfo = await fetchQualityInfoFromTorrentio(movie.tconst);
                        
                        if (qualityInfo.error) {
                            errors.push({
                                searchedTitle: searchTitle,
                                foundTitle: movie.title,
                                tconst: movie.tconst,
                                error: qualityInfo.error,
                                source: 'database'
                            });
                            continue;
                        }

                        // Cache the result
                        cache.set(cacheKey, qualityInfo);
                        
                        // Add to results
                        results[movie.tconst] = qualityInfo;
                        movieInfos.push({
                            tconst: movie.tconst,
                            title: movie.title,
                            searchedTitle: searchTitle,
                            source: 'database'
                        });
                        continue;
                    }

                    // Fallback: Search using TMDB API
                    console.log(`Movie not found in database, trying TMDB fallback for: ${searchTitle}`);
                    
                    const tmdbMovie = await searchMovieByTitleTmdb(searchTitle);
                    
                    if (!tmdbMovie) {
                        errors.push({
                            searchedTitle: searchTitle,
                            error: 'Movie not found in database or TMDB',
                            source: 'none'
                        });
                        continue;
                    }

                    // Get movie details to extract IMDb ID
                    const movieDetails = await getMovieDetailsFromTmdb(tmdbMovie.tmdb_id);
                    
                    if (!movieDetails) {
                        errors.push({
                            searchedTitle: searchTitle,
                            foundTitle: tmdbMovie.title,
                            tmdb_id: tmdbMovie.tmdb_id,
                            error: 'Movie found in TMDB but no IMDb ID available',
                            source: 'tmdb_search'
                        });
                        continue;
                    }

                    console.log(`Found movie via TMDB fallback: ${movieDetails.title} (${movieDetails.imdb_id})`);

            // Check cache first
                    const cacheKey = `imdb-${movieDetails.imdb_id}`;
            const cached = cache.get(cacheKey);
            
            if (cached) {
                        console.log(`Returning cached result for TMDB fallback: ${searchTitle}`);
                        results[movieDetails.imdb_id] = cached;
                        movieInfos.push({
                            tconst: movieDetails.imdb_id,
                            title: movieDetails.title,
                            searchedTitle: searchTitle,
                            tmdb_id: tmdbMovie.tmdb_id,
                            source: 'tmdb_fallback'
                        });
                        continue;
            }

            // Fetch quality info from Torrentio API
                    const qualityInfo = await fetchQualityInfoFromTorrentio(movieDetails.imdb_id);
            
            if (qualityInfo.error) {
                        errors.push({
                            searchedTitle: searchTitle,
                            foundTitle: movieDetails.title,
                            tconst: movieDetails.imdb_id,
                            tmdb_id: tmdbMovie.tmdb_id,
                    error: qualityInfo.error,
                            source: 'tmdb_fallback'
                        });
                        continue;
            }

            // Cache the result
            cache.set(cacheKey, qualityInfo);

                    // Add to results
                    results[movieDetails.imdb_id] = qualityInfo;
                    movieInfos.push({
                        tconst: movieDetails.imdb_id,
                        title: movieDetails.title,
                        searchedTitle: searchTitle,
                        tmdb_id: tmdbMovie.tmdb_id,
                        source: 'tmdb_fallback'
                    });

                } catch (error) {
                    console.error(`Error processing title "${searchTitle}":`, error);
                    errors.push({
                        searchedTitle: searchTitle,
                        error: error.message,
                        source: 'error'
                    });
                }
            }

            // Prepare response
            const response = {
                results: results,
                movieInfos: movieInfos,
                summary: {
                    totalRequested: titleStrings.length,
                    successful: movieInfos.length,
                    failed: errors.length
                }
            };

            // Add errors if any
            if (errors.length > 0) {
                response.errors = errors;
            }

            // Set appropriate status code
            const statusCode = movieInfos.length > 0 ? 200 : 404;

            // Add cache headers
            res.set('Cache-Control', 'public, max-age=172800'); // 48 hours in seconds
            res.status(statusCode).json(response);
            
        } catch (error) {
            console.error('Error in quality controller:', error);
            res.status(500).json({ error: error.message });
        }
    }
};