import fetch from 'node-fetch';
import { browserOptions, createStealthPage } from '../utils/browser.js';
import puppeteer from 'puppeteer-extra';

const TMDB_API_KEY = 'b29bfe548cc2a3e4225effbd54ef0fda';

export const scraperController = {
  async scrapeMovieLinks(req, res) {
    const { tmdb_id } = req.params;
    let browser = null;
    let page = null;
    let targetUrl = '';

    try {
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}`
      );
      const movieData = await tmdbResponse.json();

      const formattedTitle = movieData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      targetUrl = `https://filmfans.org/${formattedTitle}`;

      browser = await puppeteer.launch(browserOptions);
      page = await createStealthPage(browser);
      await page.setDefaultNavigationTimeout(30000);
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      const downloadData = await page.evaluate(() => {
        const entries = document.querySelectorAll('.entry');
        const releases = [];

        entries.forEach(entry => {
          const nfoContent = entry.querySelector('.nfo pre')?.textContent || '';
          const quality = entry.querySelector('.audiotag:first-child')?.textContent.match(/\d+p/) || ['unknown'];
          const sizeElement = Array.from(entry.querySelectorAll('.audiotag small')).find(el => el.textContent === 'Größe:');
          const size = sizeElement?.nextSibling?.textContent.trim() || 'unknown';
          
          const downloadLinks = Array.from(entry.querySelectorAll('.dlb.row')).map(link => ({
            url: link.href,
            hoster: link.querySelector('.col span')?.textContent?.trim() || 'unknown'
          }));

          releases.push({
            quality: quality[0],
            size: size,
            nfo: nfoContent,
            links: downloadLinks,
            audio: entry.querySelector('.audiotag img[src*="DE.svg"]') ? 'German' : 'unknown',
            releaseGroup: entry.querySelector('.audiotag:last-child')?.textContent.trim() || 'unknown'
          });
        });

        return { releases, totalReleases: releases.length };
      });

      res.json({
        success: true,
        movie: {
          tmdb_id,
          title: movieData.title,
          year: movieData.release_date?.split('-')[0],
          poster_path: movieData.poster_path,
        },
        scraped_url: targetUrl,
        releases: downloadData.releases,
        total_releases: downloadData.totalReleases
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id,
        url: targetUrl
      });
    } finally {
      if (page) await page.close();
      if (browser) await browser.close();
    }
  }
};
