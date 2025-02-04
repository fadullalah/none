import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const SCRAPER_API_KEY = '169e05c208dcbe5e453edd9c5957cc40';
const UI_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1Mjc1NTIsIm5iZiI6MTczMTUyNzU1MiwiZXhwIjoxNzYyNjMxNTcyLCJkYXRhIjp7InVpZCI6MzYxNTkxLCJ0b2tlbiI6Ijc4NjdlYzc2NzcwODAyNjcxNWNlNTZjMWJiZDI1N2NkIn19.vXKdWeU8R_xe4gUMBg-hIxkftFogPdZEGtXvAw0IC-Q'
];

function getScraperUrl(url) {
    return `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
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
    const id = link ? link.split('/detail/')[1] : null;
    
    return { title: itemTitle, year: itemYear, link, id };
  }).get();

  const exactMatch = results.find(result => {
    const titleMatch = result.title.toLowerCase() === title.toLowerCase();
    const yearMatch = !year || !result.year || Math.abs(result.year - year) <= 1;
    return titleMatch && yearMatch;
  });

  return exactMatch;
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

async function tryUrlBasedId(title, year, type) {
  const formattedTitle = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const prefix = type === 'movie' ? 'm-' : 't-';
  const url = getScraperUrl(`https://showbox.media/${type}/${prefix}${formattedTitle}-${year}`);
  
  console.log(`🎯 Trying URL-based approach: ${url}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    console.log('⚠️ URL-based approach failed');
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  
  const detailUrl = $('link[rel="canonical"]').attr('href') || 
                   $('.watch-now').attr('href') || 
                   $('a[href*="/detail/"]').attr('href');
                   
  if (detailUrl) {
    const idMatch = detailUrl.match(/\/detail\/(\d+)/);
    if (idMatch) {
      console.log(`✅ Found ID via URL approach: ${idMatch[1]}`);
      return idMatch[1];
    }
  }
  
  return null;
}

async function fetchFebboxFiles(shareKey) {
  const randomToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];
  const fileListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=0`;
  
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
  
  return data.data.file_list.filter(file => file.is_dir === 0);
}

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode } = req.query;
    let showboxId = null;
    let tmdbData = null;

    console.log(`\n🎬 Starting ShowBox scrape for TMDB ID: ${tmdbId} [${type}]`);
    
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
      
      const files = await fetchFebboxFiles(shareKey);
      const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];
      
      const streamLinks = await Promise.all(files.map(async (file) => {
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

      if (type === 'tv') {
        const seasons = {};
        const seasonFolders = files.filter(file => 
          file.is_dir === 1 && file.file_name.toLowerCase().includes('season')
        );

        for (const seasonFolder of seasonFolders) {
          const seasonNumber = parseInt(seasonFolder.file_name.match(/\d+/)?.[0] || '0', 10);
          if (isNaN(seasonNumber)) continue;

          const episodeFiles = await fetchFebboxFiles(shareKey, seasonFolder.fid);
          seasons[seasonNumber] = await Promise.all(episodeFiles.map(async (episodeFile) => {
            const ext = episodeFile.file_name.split('.').pop().toLowerCase();
            const episodeNumber = parseInt(episodeFile.file_name.match(/E(\d+)/i)?.[1] || '0', 10);
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
        }

        if (season && episode) {
          const targetSeason = seasons[parseInt(season, 10)];
          if (!targetSeason) throw new Error('Season not found');
          
          const targetEpisode = targetSeason.find(e => e.episode === parseInt(episode, 10));
          if (!targetEpisode) throw new Error('Episode not found');
          
          return res.json({
            success: true,
            tmdb_id: tmdbId,
            type,
            title,
            year,
            showbox_id: showboxId,
            febbox_url: febboxUrl,
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
            streams: targetEpisode
          });
        }

        return res.json({
          success: true,
          tmdb_id: tmdbId,
          type,
          title,
          year,
          showbox_id: showboxId,
          febbox_url: febboxUrl,
          seasons
        });
      }

      return res.json({
        success: true,
        tmdb_id: tmdbId,
        type,
        title,
        year,
        showbox_id: showboxId,
        febbox_url: febboxUrl,
        streams: streamLinks
      });

    } catch (error) {
      console.error('❌ ShowBox scraping failed:', {
        error: error.message,
        stack: error.stack,
        tmdbId,
        type,
        showboxId,
        title: tmdbData?.title || tmdbData?.name || 'Unknown',
        year: tmdbData?.release_date || tmdbData?.first_air_date || 'Unknown'
      });
      
      return res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        showbox_id: showboxId
      });
    }
  }
};