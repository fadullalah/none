import puppeteer from 'puppeteer-extra';
import { browserOptions, createStealthPage } from '../utils/browser.js';
import { getProxyEnabledBrowserOptions } from '../utils/proxy-integration.js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const UI_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1Mjc1NTIsIm5iZiI6MTczMTUyNzU1MiwiZXhwIjoxNzYyNjMxNTcyLCJkYXRhIjp7InVpZCI6MzYxNTkxLCJ0b2tlbiI6Ijc4NjdlYzc2NzcwODAyNjcxNWNlNTZjMWJiZDI1N2NkIn19.vXKdWeU8R_xe4gUMBg-hIxkftFogPdZEGtXvAw0IC-Q'
];

async function searchShowboxByTitle(title, type, year) {
  console.log(`🔎 Searching ShowBox for: "${title}" (${year}) [${type}]`);
  const searchUrl = `https://showbox.media/search?keyword=${encodeURIComponent(title)}`;
  console.log(`📡 Search URL: ${searchUrl}`);
  
  const response = await fetch(searchUrl);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const results = $('.flw-item').map((_, item) => {
    const link = $(item).find('.film-poster-ahref').attr('href');
    const itemTitle = $(item).find('.film-name').text().trim();
    const yearText = $(item).find('.film-year, .year, [class*="year"]').text().trim();
    const yearMatch = yearText.match(/\d{4}/);
    const itemYear = yearMatch ? parseInt(yearMatch[0]) : null;
    
    console.log(`📺 Found result: "${itemTitle}" (${itemYear || 'Unknown Year'}) - ${link}`);
    return {
      title: itemTitle,
      year: itemYear,
      link: link,
      id: link ? link.split('/detail/')[1] : null
    };
  }).get();

  const exactMatch = results.find(result => {
    const titleMatch = result.title.toLowerCase() === title.toLowerCase();
    const yearMatch = !year || !result.year || Math.abs(result.year - year) <= 1;
    return titleMatch && yearMatch;
  });

  if (exactMatch) {
    console.log(`✅ Found match: ${exactMatch.title} (${exactMatch.year}) - ID: ${exactMatch.id}`);
  } else {
    console.log(`❌ No match found for "${title}" (${year})`);
    console.log('Available results:', JSON.stringify(results, null, 2));
  }

  return exactMatch;
}

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    const { season, episode } = req.query;
    let browser = null;
    let page = null;
    let targetUrl = '';
    let tmdbData = null;

    console.log(`\n🎬 Starting ShowBox scrape for TMDB ID: ${tmdbId} [${type}]`);
    console.log(`📺 Season: ${season}, Episode: ${episode}`);

    try {
      console.log(`🎯 Fetching TMDB data...`);
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${process.env.API_TOKEN}`
      );
      tmdbData = await tmdbResponse.json();
      console.log(`📊 TMDB Response:`, {
        title: tmdbData.title || tmdbData.name,
        release_date: tmdbData.release_date || tmdbData.first_air_date
      });

      const title = tmdbData.title || tmdbData.name;
      const year = new Date(tmdbData.release_date || tmdbData.first_air_date).getFullYear();
      
      const formattedTitle = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const prefix = type === 'movie' ? 'm-' : 't-';
      targetUrl = `https://www.showbox.media/${type}/${prefix}${formattedTitle}-${year}`;
      
      console.log(`🎯 Initial target URL: ${targetUrl}`);
      let response = await fetch(targetUrl);
      console.log(`📊 Initial response status: ${response.status}`);
      
      if (!response.ok) {
        console.log('⚠️ Title-based URL failed, initiating search fallback...');
        const searchResult = await searchShowboxByTitle(title, type, year);
        
        if (searchResult) {
          targetUrl = `https://www.showbox.media/${type}/detail/${searchResult.id}`;
          console.log(`🎯 New target URL from search: ${targetUrl}`);
          response = await fetch(targetUrl);
          if (!response.ok) {
            throw new Error('Search result URL not accessible');
          }
        } else {
          throw new Error('Show not found via title or search');
        }
      }

      console.log('🌐 Launching browser...');
      browser = await puppeteer.launch({
        ...getProxyEnabledBrowserOptions(),
        headless: false
      });
      
      console.log('📄 Creating new page...');
      page = await createStealthPage(browser);

      await page.setRequestInterception(true);
      page.on('request', request => {
        const resourceType = request.resourceType();
        if (['media', 'websocket', 'manifest', 'other'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      console.log('🚀 Navigating to target URL...');
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      const isEpisodeList = await page.evaluate(() => {
        return !!document.querySelector('.seasons-list-new');
      });
      console.log(`📺 Is episode list page: ${isEpisodeList}`);

      if (isEpisodeList) {
        console.log('🎯 Handling TV show episode...');
        await page.waitForSelector('.eps-item');
        const firstEpisode = await page.$('.eps-item');
        if (!firstEpisode) throw new Error('No episodes found');
        await firstEpisode.click();
      } else {
        console.log('🎯 Handling movie...');
        const playButton = await page.evaluate(() => {
          const selectors = [
            '.play_button',
            'button.play',
            '[class*="play"]',
            'a.btn-play',
            '.watch-now'
          ];
          
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) return selector;
          }
          return null;
        });

        if (!playButton) throw new Error('Play button not found');
        console.log(`🎯 Found play button: ${playButton}`);
        await page.click(playButton);
      }

      console.log('⏳ Waiting for download app button...');
      await page.waitForSelector('.download_app', { timeout: 10000 });

      const newPagePromise = new Promise(resolve => {
        browser.on('targetcreated', async target => {
          const newPage = await target.page();
          if (newPage) {
            await newPage.waitForFunction(() => window.location.href !== 'about:blank');
            resolve(newPage);
          }
        });
      });

      console.log('🖱️ Clicking download app button...');
      await page.click('.download_app');

      const newPage = await Promise.race([
        newPagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('New page timeout')), 10000))
      ]);

      const febboxUrl = await newPage.evaluate(() => window.location.href);
      console.log(`🔗 FebBox URL: ${febboxUrl}`);
      const shareKey = febboxUrl.split('/share/')[1];
      
      const shareInfoUrl = `https://www.febbox.com/file/share_info?key=${shareKey}`;
      const shareInfoResponse = await fetch(shareInfoUrl);
      const shareInfoHtml = await shareInfoResponse.text();
      
      const $ = cheerio.load(shareInfoHtml);

      if (type === 'tv') {
        // Find all seasons
        const seasonDivs = $('.file.open_dir').filter(function() {
          return $(this).attr('data-path').toLowerCase().includes('season');
        });

        if (!seasonDivs.length) throw new Error('No seasons found');

        const seasons = [];
        for (const seasonDiv of seasonDivs) {
          const seasonPath = $(seasonDiv).attr('data-path');
          const seasonNum = parseInt(seasonPath.toLowerCase().replace('season', '').trim(), 10);
          const seasonFid = $(seasonDiv).attr('data-id');

          if (!isNaN(seasonNum)) {
            seasons.push({ season: seasonNum, folder_id: seasonFid });
          }
        }

        // If season and episode are provided, target a specific episode
        if (season && episode) {
          const targetSeason = seasons.find(s => s.season === parseInt(season, 10));
          if (!targetSeason) throw new Error(`Season ${season} not found`);

          const episodeListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${targetSeason.folder_id}`;
          const episodeResponse = await fetch(episodeListUrl);
          const episodeData = await episodeResponse.json();

          if (!episodeData?.data?.file_list?.length) {
            throw new Error('No episodes found in season');
          }

          const targetEpisode = episodeData.data.file_list.find(item => {
            const fileName = item.file_name.toUpperCase();
            return fileName.includes(`S${season}E${episode}`) || fileName.includes(`S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
          });

          if (!targetEpisode) throw new Error(`Episode ${episode} not found in season ${season}`);

          const fid = targetEpisode.fid;
          const streamLinks = await getStreamLinks(fid);

          res.json({
            success: true,
            tmdb_id: tmdbId,
            type,
            title,
            year,
            showbox_url: targetUrl,
            febbox_url: febboxUrl,
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
            stream_links: streamLinks
          });
          return;
        }

        // If no season and episode are provided, list all episodes and seasons
        const allEpisodes = [];
        for (const seasonData of seasons) {
          const episodeListUrl = `https://www.febbox.com/file/file_share_list?share_key=${shareKey}&parent_id=${seasonData.folder_id}`;
          const episodeResponse = await fetch(episodeListUrl);
          const episodeData = await episodeResponse.json();

          if (episodeData?.data?.file_list?.length) {
            for (const item of episodeData.data.file_list) {
              const fileName = item.file_name.toUpperCase();
              const episodeMatch = fileName.match(/S(\d+)E(\d+)/);
              if (episodeMatch) {
                const episodeNum = parseInt(episodeMatch[2], 10);
                const streamLinks = await getStreamLinks(item.fid);
                allEpisodes.push({
                  season: seasonData.season,
                  episode: episodeNum,
                  filename: item.file_name,
                  streams: streamLinks
                });
              }
            }
          }
        }

        // Organize episodes by season
        const organizedEpisodes = {};
        for (const episode of allEpisodes) {
          if (!organizedEpisodes[episode.season]) {
            organizedEpisodes[episode.season] = [];
          }
          organizedEpisodes[episode.season].push(episode);
        }

        res.json({
          success: true,
          tmdb_id: tmdbId,
          type,
          title,
          year,
          showbox_url: targetUrl,
          febbox_url: febboxUrl,
          episodes: organizedEpisodes
        });
        return;
      }

      // Movie logic
      const firstFile = $('.file').first();
      const fid = firstFile.attr('data-id');
      console.log(`🎬 Found movie file ID: ${fid}`);
      const streamLinks = await getStreamLinks(fid);

      res.json({
        success: true,
        tmdb_id: tmdbId,
        type,
        title,
        year,
        showbox_url: targetUrl,
        febbox_url: febboxUrl,
        stream_links: streamLinks
      });

    } catch (error) {
      console.error('❌ ShowBox scraping failed:', {
        error: error.message,
        stack: error.stack,
        tmdbId,
        type,
        targetUrl,
        title: tmdbData?.title || tmdbData?.name || 'Unknown',
        year: tmdbData?.release_date || tmdbData?.first_air_date || 'Unknown'
      });
      
      res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        attempted_url: targetUrl
      });
    } finally {
      if (page) {
        console.log('📄 Closing page...');
        await page.close();
      }
      if (browser) {
        console.log('🌐 Closing browser...');
        await browser.close();
      }
    }
  }
};

async function getStreamLinks(fid) {
  console.log(`🎯 Getting stream links for file ID: ${fid}`);
  const randomToken = UI_TOKENS[Math.floor(Math.random() * UI_TOKENS.length)];

  const playerResponse = await fetch("https://www.febbox.com/console/player", {
    method: 'POST',
    headers: {
      'accept': 'text/plain, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-ch-ua': '"Chromium";v="130"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'cookie': `ui=${randomToken};`
    },
    body: `fid=${fid}`
  });

  const playerHtml = await playerResponse.text();
  const sourcesMatch = playerHtml.match(/var sources = (\[.*?\]);/s);
  let streamLinks = [];
  
  if (sourcesMatch) {
    const sources = JSON.parse(sourcesMatch[1]);
    streamLinks = sources
      .filter(source => source.type === "video/mp4")
      .map(source => ({
        file: source.file,
        quality: source.label
      }));
    console.log(`✅ Found ${streamLinks.length} stream links`);
    console.log('🎥 Stream qualities:', streamLinks.map(link => link.quality).join(', '));
  } else {
    console.log('⚠️ No stream sources found in player HTML');
  }

  return streamLinks;
}