import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const UI_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1Mjc1NTIsIm5iZiI6MTczMTUyNzU1MiwiZXhwIjoxNzYyNjMxNTcyLCJkYXRhIjp7InVpZCI6MzYxNTkxLCJ0b2tlbiI6Ijc4NjdlYzc2NzcwODAyNjcxNWNlNTZjMWJiZDI1N2NkIn19.vXKdWeU8R_xe4gUMBg-hIxkftFogPdZEGtXvAw0IC-Q'
];

async function searchShowboxByTitle(title, type, year) {
  console.log(`🔎 Searching ShowBox for: "${title}" (${year}) [${type}]`);
  const searchUrl = `https://showbox.media/search?keyword=${encodeURIComponent(title)}`;
  
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
  const apiUrl = `https://showbox.media/index/share_link?id=${showboxId}&type=${type === 'movie' ? 1 : 2}`;
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
      'accept': 'text/plain, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      'cookie': `ui=${randomToken};`
    },
    body: `fid=${fid}`
  });

  const playerHtml = await playerResponse.text();
  const sourcesMatch = playerHtml.match(/var sources = (\[.*?\]);/s);
  
  if (!sourcesMatch) {
    console.log('⚠️ No stream sources found in player HTML');
    return [];
  }

  const sources = JSON.parse(sourcesMatch[1]);
  return sources
    .filter(source => source.type === "video/mp4")
    .map(source => ({
      file: source.file,
      quality: source.label
    }));
}

async function tryUrlBasedId(title, year, type) {
  const formattedTitle = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const prefix = type === 'movie' ? 'm-' : 't-';
  const url = `https://showbox.media/${type}/${prefix}${formattedTitle}-${year}`;
  
  console.log(`🎯 Trying URL-based approach: ${url}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    console.log('⚠️ URL-based approach failed');
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  
  // Extract ID from meta tags or other elements
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

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode } = req.query;
    let showboxId = null;
    let tmdbData = null;

    console.log(`\n🎬 Starting ShowBox scrape for TMDB ID: ${tmdbId} [${type}]`);
    
    try {
      // Fetch TMDB data
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${process.env.API_TOKEN}`
      );
      tmdbData = await tmdbResponse.json();

      if (!tmdbData || (!tmdbData.title && !tmdbData.name)) {
        throw new Error('Invalid TMDB data received');
      }      

      console.log('TMDB Response:', JSON.stringify(tmdbData, null, 2));
      console.log('TMDB API Response Status:', tmdbResponse.status);
      console.log('TMDB API Response Headers:', tmdbResponse.headers);
      console.log('TMDB API Response Body:', tmdbData);      
      
      const title = tmdbData.title || tmdbData.name;
      const year = new Date(tmdbData.release_date || tmdbData.first_air_date).getFullYear();
      
      // Try URL-based approach first
      showboxId = await tryUrlBasedId(title, year, type);
      
      // If URL approach fails, fall back to search
      if (!showboxId) {
        console.log('⚠️ Falling back to search method...');
        const searchResult = await searchShowboxByTitle(title, type, year);
        if (!searchResult?.id) {
          throw new Error('Content not found on ShowBox');
        }
        showboxId = searchResult.id;
      }

      // Get FebBox share link directly using ShowBox API
      const febboxUrl = await getFebboxShareLink(showboxId, type);
      const shareKey = febboxUrl.split('/share/')[1];
      
      // Get file list from FebBox
      const shareInfoUrl = `https://www.febbox.com/file/share_info?key=${shareKey}`;
      const shareInfoResponse = await fetch(shareInfoUrl);
      const shareInfoHtml = await shareInfoResponse.text();
      const $ = cheerio.load(shareInfoHtml);

      if (type === 'tv') {
        // Handle TV show logic
        const seasons = $('.file.open_dir')
          .filter(function() {
            return $(this).attr('data-path').toLowerCase().includes('season');
          })
          .map((_, div) => ({
            season: parseInt($(div).attr('data-path').toLowerCase().replace('season', '').trim(), 10),
            folder_id: $(div).attr('data-id')
          }))
          .get()
          .filter(s => !isNaN(s.season));

        if (!seasons.length) {
          throw new Error('No seasons found');
        }

        if (season && episode) {
          // Get specific episode
          const targetSeason = seasons.find(s => s.season === parseInt(season, 10));
          if (!targetSeason) {
            throw new Error(`Season ${season} not found`);
          }

          const episodeListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${targetSeason.folder_id}`;
          const episodeResponse = await fetch(episodeListUrl);
          const episodeData = await episodeResponse.json();

          if (!episodeData?.data?.file_list?.length) {
            throw new Error('No episodes found in season');
          }

          const targetEpisode = episodeData.data.file_list.find(item => {
            const fileName = item.file_name.toUpperCase();
            const seasonPad = String(season).padStart(2, '0');
            const episodePad = String(episode).padStart(2, '0');
            return fileName.includes(`S${season}E${episode}`) || 
                   fileName.includes(`S${seasonPad}E${episodePad}`);
          });

          if (!targetEpisode) {
            throw new Error(`Episode ${episode} not found in season ${season}`);
          }

          const streamLinks = await getStreamLinks(targetEpisode.fid);
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
            stream_links: streamLinks
          });
        }

        // Get all episodes
        const episodes = {};
        for (const seasonData of seasons) {
          const episodeListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${seasonData.folder_id}`;
          const episodeResponse = await fetch(episodeListUrl);
          const episodeData = await episodeResponse.json();

          if (episodeData?.data?.file_list?.length) {
            episodes[seasonData.season] = await Promise.all(
              episodeData.data.file_list
                .filter(item => {
                  const match = item.file_name.toUpperCase().match(/S(\d+)E(\d+)/);
                  return match && parseInt(match[1], 10) === seasonData.season;
                })
                .map(async item => {
                  const match = item.file_name.toUpperCase().match(/S(\d+)E(\d+)/);
                  const streamLinks = await getStreamLinks(item.fid);
                  return {
                    season: seasonData.season,
                    episode: parseInt(match[2], 10),
                    filename: item.file_name,
                    streams: streamLinks
                  };
                })
            );
          }
        }

        return res.json({
          success: true,
          tmdb_id: tmdbId,
          type,
          title,
          year,
          showbox_id: showboxId,
          febbox_url: febboxUrl,
          episodes
        });
      }

      // Handle movie logic
      const firstFile = $('.file').first();
      const fid = firstFile.attr('data-id');
      const streamLinks = await getStreamLinks(fid);

      return res.json({
        success: true,
        tmdb_id: tmdbId,
        type,
        title,
        year,
        showbox_id: showboxId,
        febbox_url: febboxUrl,
        stream_links: streamLinks
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