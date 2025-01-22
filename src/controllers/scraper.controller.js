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
          const morespecElement = entry.querySelector('.morespec');
          const releaseName = morespecElement?.textContent.trim() || '';
          const nfoContent = entry.querySelector('.nfo pre')?.textContent || '';
      
          // Get resolution from audiotag spans
          const resolutionElement = Array.from(entry.querySelectorAll('.audiotag small')).find(el => 
            el.textContent.includes('Auflösung:')
          );
      
          let quality = {
            resolution: 'unknown',
            source: 'unknown',
            codec: 'unknown'
          };
      
          // Check morespec span first
          if (morespecElement) {
            const morespecText = morespecElement.textContent;
            quality.resolution = morespecText.match(/\d+p/)?.[0] || 
                                morespecText.match(/\d{3,4}x\d{3,4}/)?.[0] || 
                                quality.resolution;
            quality.source = morespecText.match(/(?:BluRay|WEB-DL|WEBRiP|HDRip|BRRip|TS|HD|UHD)/i)?.[0] || quality.source;
            quality.codec = morespecText.match(/(?:x264|x265|HEVC|AVC)/i)?.[0] || quality.codec;
          }
      
          // Update resolution from audiotag if found
          if (resolutionElement) {
            quality.resolution = resolutionElement.nextSibling?.textContent.trim() || quality.resolution;
          }
      
          // Get size from audiotag spans
          const sizeElement = Array.from(entry.querySelectorAll('.audiotag small')).find(el => 
            el.textContent.includes('Größe:')
          );
          const size = sizeElement?.nextSibling?.textContent.trim() || 'unknown';
      
          releases.push({
            releaseName,
            quality,
            size,
            audio: {
              languages: {
                german: entry.querySelector('.audiotag img[src*="DE.svg"]') !== null || nfoContent.includes('German'),
                english: entry.querySelector('.audiotag img[src*="EN.svg"]') !== null || nfoContent.includes('English')
              },
              format: nfoContent.match(/(?:DTS|DD\+|AAC|AC3|EAC3)/i)?.[0] || 'unknown',
              channels: nfoContent.match(/(?:\d\.\d(?:\s*channels)?|\d\s*Kanäle)/i)?.[0] || 'unknown'
            },
            releaseGroup: releaseName.split('-').pop() || 'unknown',
            uploadDate: entry.querySelector('.date')?.textContent.trim() || 'unknown',
            technicalDetails: {
              duration: nfoContent.match(/(?:duration|dauer).*?(\d+\s*h\s*\d+\s*min)/i)?.[1] || 'unknown',
              container: nfoContent.match(/Format\s*:\s*([^\n]+)/i)?.[1] || 'unknown',
              videoFormat: nfoContent.match(/Video.*?Format\s*:\s*([^\n]+)/i)?.[1] || 'unknown'
            }
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
