import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import NodeCache from 'node-cache';
import { bunnyStreamController } from './bunny.controller.js';

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Caches
const showboxCache = new NodeCache({ stdTTL: 43200 }); // 12 hours
const imdbCache = new NodeCache({ stdTTL: 172800 }); // 48 hours
const urlCache = new NodeCache({ stdTTL: 86400 }); // 24 hours
const streamLinkCache = new NodeCache({ stdTTL: 3600 }); // 1 hour

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

async function getStreamLinks(fid, customToken = null) {
  const cacheKey = `stream:${fid}`;
  const cached = streamLinkCache.get(cacheKey);
  if (cached) return cached;
  
  const token = customToken || UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];

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
      'share_key': '',
      '_token': token
    }).toString()
  });

  const playerHtml = await playerResponse.text();
  const sourcesMatch = playerHtml.match(/var sources = (\[.*?\]);/s);
  
  if (!sourcesMatch) return [];

  const sources = JSON.parse(sourcesMatch[1]);
  streamLinkCache.set(cacheKey, sources);
  return sources;
}

async function searchIMDB(title) {
  const cacheKey = `imdb:${title.toLowerCase()}`;
  const cached = imdbCache.get(cacheKey);
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
    
    imdbCache.set(cacheKey, results);
    return results;
  } catch (error) {
    console.error('❌ IMDB search failed:', error);
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

  // If we found a match but need to get its detail page ID
  if (match && !match.id.match(/^\d+$/)) {
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
      console.error('Failed to fetch detail page:', error);
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
  const cachedId = urlCache.get(cacheKey);
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
          urlCache.set(cacheKey, idMatch[1]);
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
        urlCache.set(cacheKey, successfulResult.id);
        return successfulResult.id;
      }
    }
  } catch (error) {
    console.error(`❌ Error in tryUrlBasedId:`, error);
  }
  
  return null;
}

async function fetchFebboxFiles(shareKey, parentId = 0, customToken = null) {
  const token = customToken || UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
  const fileListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${parentId}`;
  
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
  
  return data.data.file_list;
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

function backgroundUpload(url, metadata) {
  bunnyStreamController.uploadVideoToCollection(url, metadata)
    .then(() => console.log(`✅ Background upload completed for: ${metadata.title}`))
    .catch(err => console.error(`❌ Background upload failed: ${err.message}`));
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

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode, token, skipUpload, fastMode } = req.query;
    let showboxId = null;
    let tmdbData = null;
    const userToken = token || null;
    
    const tokenIdentifier = userToken || 'default';
    const cacheKey = `showbox:${tmdbId}:${type}${season ? `:s${season}` : ''}${episode ? `:e${episode}` : ''}:js:${tokenIdentifier}`;
    
    const cachedResult = showboxCache.get(cacheKey);
    if (cachedResult) {
      return res.json({...cachedResult, source: 'cache'});
    }

    console.log(`\n🎬 Starting ShowBox scrape for TMDB ID: ${tmdbId} [${type}]${userToken ? ' with user token' : ''}`);
    
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
      const files = await fetchFebboxFiles(shareKey, 0, userToken);
      
      if (type === 'tv') {
        const seasons = {};
        const seasonFolders = files.filter(file => 
          file.is_dir === 1 && file.file_name.toLowerCase().includes('season')
        );

        if (season) {
          const targetSeasonFolder = seasonFolders.find(folder => {
            const seasonNum = parseInt(folder.file_name.match(/\d+/)?.[0] || '0', 10);
            return seasonNum === parseInt(season, 10);
          });

          if (targetSeasonFolder) {
            const episodeFiles = await fetchFebboxFiles(shareKey, targetSeasonFolder.fid, userToken);
            const seasonEpisodes = await Promise.all(episodeFiles.map(async (episodeFile) => {
              const ext = episodeFile.file_name.split('.').pop().toLowerCase();
              const episodeNumber = parseInt(episodeFile.file_name.match(/E(\d+)/i)?.[1] || '0', 10);
              
              if (episode && episodeNumber !== parseInt(episode, 10)) {
                return null;
              }

              const qualityMatch = episodeFile.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
              const playerSources = await getStreamLinks(episodeFile.fid, userToken);

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
            seasons
          };

          if (!skipUpload) {
            const qualityStreams = extractTopQualityStreams(targetEpisode);
            if (qualityStreams.primary) {
              backgroundUpload(qualityStreams.primary, {
                title: `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId})`,
                type: 'tv',
                tmdbId,
                season: parseInt(season, 10),
                episode: parseInt(episode, 10),
                quality: qualityStreams.primaryQuality
              });
            }
          }

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
            showboxCache.set(cacheKey, responseData);
          }

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
          seasons
        };

        if (type === 'movie') {
          const qualityStreams = extractTopQualityStreams(seasons[1]);
          
          if (!skipUpload && qualityStreams.primary) {
            backgroundUpload(qualityStreams.primary, {
              title: `${title} (TMDB: ${tmdbId})`,
              type: 'movie',
              tmdbId,
              quality: qualityStreams.primaryQuality
            });
          }
        }

        if (hasValidStreams(responseData)) {
          showboxCache.set(cacheKey, responseData);
        }

        return res.json(responseData);
        
      } else {
        // Handle movies
        const videoFiles = files.filter(file => file.is_dir === 0);
        streamLinks = await Promise.all(videoFiles.map(async (file) => {
          const ext = file.file_name.split('.').pop().toLowerCase();
          const qualityMatch = file.file_name.match(/(1080p|720p|480p|360p|2160p|4k)/i);
          const playerSources = await getStreamLinks(file.fid, userToken);
          
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

        // Upload high quality stream to Bunny
        const qualityStreams = extractTopQualityStreams(targetEpisode);
        if (!skipUpload && qualityStreams.primary) {
          backgroundUpload(qualityStreams.primary, {
            title: `${title}${type === 'tv' ? ` S${season}E${episode}` : ''} (TMDB: ${tmdbId})`,
            type: 'tv',
            tmdbId,
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
            quality: qualityStreams.primaryQuality
          });
        }

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
          showboxCache.set(cacheKey, responseData);
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

      // Upload movie to Bunny CDN
      if (type === 'movie') {
        const qualityStreams = extractTopQualityStreams(streamLinks);
        
        if (!skipUpload && qualityStreams.primary) {
          backgroundUpload(qualityStreams.primary, {
            title: `${title} (TMDB: ${tmdbId})`,
            type: 'movie',
            tmdbId,
            quality: qualityStreams.primaryQuality
          });
        }
      }

      if (hasValidStreams(responseData)) {
        showboxCache.set(cacheKey, responseData);
      }

      return res.json(responseData);

    } catch (error) {
      console.error('❌ ShowBox scraping failed:', {
        error: error.message,
        tmdbId,
        type,
        showboxId,
        title: tmdbData?.title || tmdbData?.name || 'Unknown'
      });
      
      return res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        showbox_id: showboxId
      });
    }
  },

  clearCache(req, res) {
    const cleared = showboxCache.flushAll();
    return res.json({
      success: true,
      message: 'Cache cleared successfully',
      itemsCleared: cleared
    });
  },
  
  async listBunnyVideos(req, res) {
    try {
      await bunnyStreamController.initialize();
      const videos = bunnyStreamController.allVideos;
      
      return res.json({
        success: true,
        total: videos.length,
        videos: videos.map(v => ({
          id: v.guid,
          title: v.title,
          status: v.status,
          created: v.dateUploaded,
          length: v.length,
          views: v.views,
          url: v.directPlayUrl
        }))
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};