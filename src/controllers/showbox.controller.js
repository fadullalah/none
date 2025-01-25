import puppeteer from 'puppeteer-extra';
import { browserOptions, createStealthPage } from '../utils/browser.js';
import { getProxyEnabledBrowserOptions } from '../utils/proxy-integration.js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export const showboxController = {
  async getShowboxUrl(req, res) {
    const { type, tmdbId } = req.params;
    let browser = null;
    let page = null;
    let targetUrl = '';

    try {
      // Use TMDB API directly
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${process.env.API_TOKEN}`
      );
      const tmdbData = await tmdbResponse.json();

      const title = tmdbData.title || tmdbData.name;
      const year = new Date(tmdbData.release_date || tmdbData.first_air_date).getFullYear();
      
      const formattedTitle = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const prefix = type === 'movie' ? 'm-' : 't-';
      targetUrl = `https://www.showbox.media/${type}/${prefix}${formattedTitle}-${year}`;
      
      console.log('🎯 Navigating to Showbox:', targetUrl);

      browser = await puppeteer.launch({
        ...getProxyEnabledBrowserOptions(),
        headless: false,
        defaultViewport: null,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });

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

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('🔍 Looking for play button...');
      const playButton = await page.evaluate(() => {
        const selectors = [
          '.play_button',
          'button.play',
          '[class*="play"]',
          'button:has-text("Play")',
          'a:has-text("Play")'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log('Found play button with selector:', selector);
            return selector;
          }
        }
        return null;
      });

      if (!playButton) {
        throw new Error('Play button not found on page');
      }

      console.log('🖱️ Clicking play button...');
      await page.click(playButton);
      console.log('🔍 Waiting for FebBox button...');
      await page.waitForSelector('.download_app');

      const newPagePromise = new Promise(resolve => {
          browser.on('targetcreated', async target => {
              const newPage = await target.page();
              if (newPage) {
                  console.log('🔄 New page detected');
                  await newPage.waitForFunction(() => window.location.href !== 'about:blank');
                  resolve(newPage);
              }
          });
      });

      console.log('🖱️ Clicking FebBox download button...');
      await page.click('.download_app');

      const newPage = await Promise.race([
          newPagePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('New page timeout')), 10000))
      ]);

      const febboxUrl = await newPage.evaluate(() => window.location.href);
      console.log('📍 FebBox URL:', febboxUrl);

      // Get video links from FebBox
      const shareKey = febboxUrl.split('/share/')[1];
      const shareInfoUrl = `https://www.febbox.com/file/share_info?key=${shareKey}`;
      const shareInfoResponse = await fetch(shareInfoUrl);
      const shareInfoHtml = await shareInfoResponse.text();
      
      const $ = cheerio.load(shareInfoHtml);
      const firstFile = $('.file').first();
      const fid = firstFile.attr('data-id');

      const playerResponse = await fetch("https://www.febbox.com/console/player", {
        method: 'POST',
        headers: {
          'accept': 'text/plain, */*; q=0.01',
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
          'cookie': `ui=${process.env.UI_TOKEN};`
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
      }

      await newPage.close();

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
      console.error('❌ Showbox scraping failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id: tmdbId,
        type,
        attempted_url: targetUrl
      });
    } finally {
      if (page) await page.close();
      if (browser) await browser.close();
    }
  }
};
