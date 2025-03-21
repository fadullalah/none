import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import NodeCache from 'node-cache';
import { bunnyStreamController } from './bunny.controller.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a cache for storing ShowBox results (TTL: 6 hours)
const showboxCache = new NodeCache({ stdTTL: 21600 });

// Add these near the top with other cache declarations
const imdbCache = new NodeCache({ stdTTL: 86400 }); // 24 hours
const urlCache = new NodeCache({ stdTTL: 43200 }); // 12 hours

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

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode, py } = req.query;
    let showboxId = null;
    let tmdbData = null;
    const usePython = py !== undefined;

    // Generate a unique cache key based on request parameters
    const cacheKey = `showbox:${tmdbId}:${type}${season ? `:s${season}` : ''}${episode ? `:e${episode}` : ''}:${usePython ? 'py' : 'js'}`;
    
    // Check cache first
    const cachedResult = showboxCache.get(cacheKey);
    if (cachedResult) {
      console.log(`✅ Cache hit for ${cacheKey}`);
      return res.json({
        ...cachedResult,
        source: 'cache'
      });
    }

    console.log(`\n🎬 Starting ShowBox scrape for TMDB ID: ${tmdbId} [${type}]${usePython ? ' using Python scraper' : ''}`);
    
    try {
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${process.env.API_TOKEN}`
      );
      tmdbData = await tmdbResponse.json();
      
      const title = tmdbData.title || tmdbData.name;
      const year = new Date(tmdbData.release_date || tmdbData.first_air_date).getFullYear();
      
      showboxId = await tryUrlBasedId(title, year, type);
      
      if (!showboxId) {
        console.log('⚠️ Falling back to search method...');
        const searchResult = await searchShowboxByTitle(title, type, year);
        if (!searchResult?.id) {
          throw new Error('Content not found on ShowBox');
        }
        showboxId = searchResult.id;
      }

      const febboxUrl = await getFebboxShareLink(showboxId, type);
      const shareKey = febboxUrl.split('/share/')[1];

      let streamLinks = [];
      let useJavaScript = false;

      if (usePython) {
        console.log('🐍 Using Python scraper for:', febboxUrl);
        try {
          const randomToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
          const pythonResults = await getPythonScrapedLinks(febboxUrl, randomToken);
          console.log('✅ Python scraper results received');
          
          if (!pythonResults || !Array.isArray(pythonResults)) {
            throw new Error('Invalid Python scraper results');
          }

          streamLinks = pythonResults.map(result => ({
            filename: result.file_info.name,
            quality: result.file_info.type,
            size: result.file_info.size,
            player_streams: Object.entries(result.quality_urls).map(([quality, url]) => ({
              file: url,
              quality,
              type: 'mp4'
            }))
          }));
        } catch (pythonError) {
          console.error('❌ Python scraper failed:', pythonError);
          useJavaScript = true;
        }
      } else {
        useJavaScript = true;
      }

      if (useJavaScript) {
        console.log('🟨 Using JavaScript scraper');
        const files = await fetchFebboxFiles(shareKey);
        
        if (type === 'tv') {
          const seasons = {};
          const seasonFolders = files.filter(file => 
            file.is_dir === 1 && file.file_name.toLowerCase().includes('season')
          );

          // If specific season and episode are requested, only process that season
          if (season) {
            const targetSeasonFolder = seasonFolders.find(folder => {
              const seasonNum = parseInt(folder.file_name.match(/\d+/)?.[0] || '0', 10);
              return seasonNum === parseInt(season, 10);
            });

            if (targetSeasonFolder) {
              const episodeFiles = await fetchFebboxFiles(shareKey, targetSeasonFolder.fid);
              const seasonEpisodes = await Promise.all(episodeFiles.map(async (episodeFile) => {
                const ext = episodeFile.file_name.split('.').pop().toLowerCase();
                const episodeNumber = parseInt(episodeFile.file_name.match(/E(\d+)/i)?.[1] || '0', 10);
                
                // If specific episode is requested, only process that episode
                if (episode && episodeNumber !== parseInt(episode, 10)) {
                  return null;
                }

                const qualityMatch = episodeFile.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
                const playerSources = await getStreamLinks(episodeFile.fid);

                return {
                  episode: episodeNumber,
                  filename: episodeFile.file_name,
                  quality: qualityMatch ? qualityMatch[1] : 'Unknown',
                  type: ext,
                  size: episodeFile.file_size,
                  player_streams: playerSources,
                  direct_download: `https://www.febbox.com/file/download_share?fid=${episodeFile.fid}&share_key=${shareKey}`
                };
              }));

              // Filter out null values and only keep the requested episode
              const filteredEpisodes = seasonEpisodes.filter(e => e !== null);
              if (filteredEpisodes.length > 0) {
                seasons[parseInt(season, 10)] = filteredEpisodes;
              }
            }
          }

          if (season && episode) {
            const targetSeason = seasons[parseInt(season, 10)];
            if (!targetSeason) {
              throw new Error('Season not found');
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
              scraper: 'javascript'
            };

            // Add type-specific data to the response
            if (type === 'tv' && useJavaScript) {
              // TV show seasons data
              Object.assign(responseData, { seasons });
            } else {
              // Movie or general streams data
              Object.assign(responseData, { streams: targetEpisode });
            }

            // Upload only the highest quality stream to Bunny
            const qualityStreams = extractTopQualityStreams(targetEpisode);
            if (qualityStreams.primary) {
              console.log(`🐰 Uploading ${type === 'movie' ? 'movie' : 'episode'}: ${title} ${type === 'tv' ? `S${season}E${episode}` : ''} [${qualityStreams.primaryQuality}]`);
              
              try {
                // Only upload primary (highest) quality
                bunnyStreamController.uploadVideoByUrl(
                  qualityStreams.primary,
                  `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId}) [${qualityStreams.primaryQuality}]`
                );
              } catch (uploadError) {
                console.error(`🐰 Upload error: ${uploadError.message}`);
              }
            }

            // Store in cache before returning
            showboxCache.set(cacheKey, responseData);

            return res.json(responseData);
          }

          const responseData = {
            success: true,
            tmdb_id: tmdbId,
            type,
            title,
            year,
            showbox_id: showboxId,
            febbox_url: febboxUrl,
            seasons,
            scraper: 'javascript'
          };

          // Add type-specific data to the response
          if (type === 'tv' && useJavaScript) {
            // TV show seasons data
            Object.assign(responseData, { seasons });
          } else {
            // Movie or general streams data
            Object.assign(responseData, { streams: seasons[1] });
          }

          // Upload only the highest quality stream to Bunny for movies
          if (type === 'movie') {
            console.log('Attempting to upload movie to Bunny Stream...');
            
            // Debug the streamLinks structure
            console.log(`Stream links structure: ${typeof seasons[1]}`);
            console.log(`Stream links is array: ${Array.isArray(seasons[1])}`);
            console.log(`Stream links length: ${seasons[1]?.length || 'N/A'}`);
            
            if (seasons[1] && seasons[1].length > 0) {
              console.log('Sample stream link structure:', JSON.stringify(seasons[1][0], null, 2));
            }
            
            const qualityStreams = extractTopQualityStreams(seasons[1]);
            
            console.log(`Highest quality URLs found: Primary=${qualityStreams.primary || 'None'}, Secondary=${qualityStreams.secondary || 'None'}`);
            
            if (qualityStreams.primary) {
              console.log(`🐰 Uploading ${type === 'movie' ? 'movie' : 'episode'}: ${title} ${type === 'tv' ? `S${season}E${episode}` : ''} [${qualityStreams.primaryQuality}]`);
              
              try {
                // Only upload primary (highest) quality
                bunnyStreamController.uploadVideoByUrl(
                  qualityStreams.primary,
                  `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId}) [${qualityStreams.primaryQuality}]`
                );
              } catch (uploadError) {
                console.error(`🐰 Upload error: ${uploadError.message}`);
              }
            }
          }

          // Store in cache before returning
          showboxCache.set(cacheKey, responseData);

          return res.json(responseData);
        } else {
          // Handle movies
          const videoFiles = files.filter(file => file.is_dir === 0);
          streamLinks = await Promise.all(videoFiles.map(async (file) => {
            const ext = file.file_name.split('.').pop().toLowerCase();
            const qualityMatch = file.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
            const playerSources = await getStreamLinks(file.fid);
            
            return {
              filename: file.file_name,
              quality: qualityMatch ? qualityMatch[1] : 'Unknown',
              type: ext,
              size: file.file_size,
              player_streams: playerSources,
              direct_download: `https://www.febbox.com/file/download_share?fid=${file.fid}&share_key=${shareKey}`
            };
          }));
        }
      }

      // Return results
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
          streams: targetEpisode,
          scraper: usePython ? 'python' : 'javascript'
        };

        // Add type-specific data to the response
        if (type === 'tv' && useJavaScript) {
          // TV show seasons data
          Object.assign(responseData, { seasons });
        } else {
          // Movie or general streams data
          Object.assign(responseData, { streams: targetEpisode });
        }

        // Upload only the highest quality stream to Bunny
        const qualityStreams = extractTopQualityStreams(targetEpisode);
        if (qualityStreams.primary) {
          console.log(`🐰 Uploading ${type === 'movie' ? 'movie' : 'episode'}: ${title} ${type === 'tv' ? `S${season}E${episode}` : ''} [${qualityStreams.primaryQuality}]`);
          
          try {
            // Only upload primary (highest) quality
            bunnyStreamController.uploadVideoByUrl(
              qualityStreams.primary,
              `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId}) [${qualityStreams.primaryQuality}]`
            );
          } catch (uploadError) {
            console.error(`🐰 Upload error: ${uploadError.message}`);
          }
        }

        // Store in cache before returning
        showboxCache.set(cacheKey, responseData);

        return res.json(responseData);
      }

      const responseData = {
        success: true,
        tmdb_id: tmdbId,
        type,
        title,
        year,
        showbox_id: showboxId,
        febbox_url: febboxUrl,
        streams: streamLinks,
        scraper: usePython ? 'python' : 'javascript'
      };

      // Add type-specific data to the response
      if (type === 'tv' && useJavaScript) {
        // TV show seasons data
        Object.assign(responseData, { seasons });
      } else {
        // Movie or general streams data
        Object.assign(responseData, { streams: streamLinks });
      }

      // Upload only the highest quality stream to Bunny for movies
      if (type === 'movie') {
        console.log('Attempting to upload movie to Bunny Stream...');
        
        // Debug the streamLinks structure
        console.log(`Stream links structure: ${typeof streamLinks}`);
        console.log(`Stream links is array: ${Array.isArray(streamLinks)}`);
        console.log(`Stream links length: ${streamLinks?.length || 'N/A'}`);
        
        if (streamLinks && streamLinks.length > 0) {
          console.log('Sample stream link structure:', JSON.stringify(streamLinks[0], null, 2));
        }
        
        const qualityStreams = extractTopQualityStreams(streamLinks);
        
        console.log(`Highest quality URLs found: Primary=${qualityStreams.primary || 'None'}, Secondary=${qualityStreams.secondary || 'None'}`);
        
        if (qualityStreams.primary) {
          console.log(`🐰 Uploading ${type === 'movie' ? 'movie' : 'episode'}: ${title} ${type === 'tv' ? `S${season}E${episode}` : ''} [${qualityStreams.primaryQuality}]`);
          
          try {
            // Only upload primary (highest) quality
            bunnyStreamController.uploadVideoByUrl(
              qualityStreams.primary,
              `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId}) [${qualityStreams.primaryQuality}]`
            );
          } catch (uploadError) {
            console.error(`🐰 Upload error: ${uploadError.message}`);
          }
        }
      }

      // Store in cache before returning
      showboxCache.set(cacheKey, responseData);

      return res.json(responseData);

    } catch (error) {
      console.error('❌ ShowBox scraping failed:', {
        error: error.message,
        stack: error.stack,
        tmdbId,
        type,
        showboxId,
        title: tmdbData?.title || tmdbData?.name || 'Unknown',
        year: tmdbData?.release_date || tmdbData?.first_air_date || 'Unknown',
        scraper: usePython ? 'python' : 'javascript'
      });
      
      // Don't cache errors
      return res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        showbox_id: showboxId,
        scraper: usePython ? 'python' : 'javascript'
      });
    }
  },

  /**
   * Utility method to clear the cache (can be exposed as an endpoint if needed)
   */
  clearCache(req, res) {
    const cleared = showboxCache.flushAll();
    return res.json({
      success: true,
      message: 'Cache cleared successfully',
      itemsCleared: cleared
    });
  }
};