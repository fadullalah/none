import fetch from 'node-fetch';
import { browserOptions, createStealthPage, customNavigate } from '../utils/browser.js';
import puppeteer from 'puppeteer-extra';

const TMDB_API_KEY = 'b29bfe548cc2a3e4225effbd54ef0fda';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const seriesScraperController = {
  async scrapeSeriesLinks(req, res) {
    const { tmdb_id } = req.params;
    let browser = null;
    let page = null;
    let targetUrl = '';

    try {
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdb_id}?api_key=${TMDB_API_KEY}`
      );
      const seriesData = await tmdbResponse.json();
      
      const formattedTitle = seriesData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      targetUrl = `https://serienfans.org/${formattedTitle}`;

      browser = await puppeteer.launch({
        ...browserOptions,
        headless: true
      });

      const pages = await browser.pages();
      page = pages[0]; // Use existing page instead of creating new one
      await page.setDefaultNavigationTimeout(60000);

      await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await page.waitForSelector('.entry', { timeout: 60000 });
      await page.waitForSelector('label[for="seasonALL"]');
      await page.evaluate(() => {
        document.querySelector('input#seasonALL').click();
      });

      await delay(5000);

      const downloadData = await page.evaluate(() => {
        const entries = document.querySelectorAll('.entry');
        const releases = [];

        entries.forEach(entry => {
          const seasonInfo = entry.querySelector('h3')?.textContent.trim() || '';
          const qualityInfo = entry.querySelector('.morespec')?.textContent.trim() || '';
          const quality = qualityInfo.match(/\d+p/)?.[0] || 'unknown';
          const size = qualityInfo.match(/\d+(\.\d+)?\s*GB/)?.[0] || 'unknown';

          const audioTag = entry.querySelector('.audiotag');
          const hasGerman = audioTag?.innerHTML.includes('DE.svg') || false;
          const hasEnglish = audioTag?.innerHTML.includes('EN.svg') || false;

          const releaseGroup = entry.querySelector('.grouptag')?.textContent.trim() || 'unknown';

          const episodeList = Array.from(entry.querySelectorAll('.list.simple .row')).map(row => {
            if (row.classList.contains('head')) return null;
            
            const episodeNumber = row.querySelector('div:first-child')?.textContent.trim().replace('.', '') || '';
            const episodeTitle = row.querySelector('div:nth-child(2)')?.textContent.trim() || '';
            const episodeLinks = Array.from(row.querySelectorAll('.dlb.row')).map(link => ({
              url: link.href,
              hoster: link.querySelector('.col span')?.textContent?.trim() || 'unknown'
            }));

            return {
              episode: episodeNumber,
              title: episodeTitle,
              links: episodeLinks
            };
          }).filter(Boolean);

          const seasonLinks = Array.from(entry.querySelectorAll(':scope > .row .dlb.row')).map(link => ({
            url: link.href,
            hoster: link.querySelector('.col span')?.textContent?.trim() || 'unknown'
          }));

          releases.push({
            season: seasonInfo,
            quality,
            size,
            audio: {
              german: hasGerman,
              english: hasEnglish
            },
            releaseGroup,
            seasonLinks,
            episodes: episodeList.length > 0 ? episodeList : undefined
          });
        });

        return {
          releases,
          totalReleases: releases.length
        };
      });

      res.json({
        success: true,
        series: {
          tmdb_id,
          title: seriesData.name,
          poster_path: seriesData.poster_path
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
      if (browser) await browser.close();
    }
  }
};
