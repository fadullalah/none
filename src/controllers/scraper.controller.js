import fetch from 'node-fetch';
import { browserOptions, createStealthPage, customNavigate } from '../utils/browser.js';
import puppeteer from 'puppeteer-extra';

const TMDB_API_KEY = 'b29bfe548cc2a3e4225effbd54ef0fda';

export const scraperController = {
  async scrapeMovieLinks(req, res) {
    const { tmdb_id } = req.params;
    let browser = null;
    let page = null;
    let targetUrl = ''; // Define targetUrl at the top level

    try {
      console.log('\n=== Starting Scraping Process ===');
      console.log(`🎬 [1/6] Fetching TMDB data for ID: ${tmdb_id}`);
      const tmdbResponse = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}`
      );
      const movieData = await tmdbResponse.json();
      console.log(`✅ TMDB data received: "${movieData.title}" (${movieData.release_date})`);

      // URL Formation
      const formattedTitle = movieData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      targetUrl = `https://filmfans.org/${formattedTitle}`; // Assign targetUrl here
      console.log(`🔗 [2/6] Target URL created: ${targetUrl}`);

      // Browser Launch
      console.log('🌐 [3/6] Launching browser with stealth mode...');
      browser = await puppeteer.launch({
        ...browserOptions,
        headless: false, // This makes the browser visible
        defaultViewport: {
          width: 1920,
          height: 1080
        },
        args: [
          '--start-maximized',
          '--window-size=1920,1080'
        ],
        timeout: 30000
      });      
      console.log('✅ Browser launched successfully');

      // Page Creation
      console.log('📄 [4/6] Creating new page with stealth settings...');
      page = await createStealthPage(browser);
      await page.setDefaultNavigationTimeout(30000);
      console.log('✅ Page created with stealth settings');

      // Navigation
      console.log(`🚀 [5/6] Navigating to target URL...`);
      const response = await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      console.log(`✅ Navigation complete (Status: ${response.status()})`);
        // Content Extraction
        console.log('🔍 [6/6] Searching for download links and NFO data...');
        const downloadData = await page.evaluate(() => {
          const entries = document.querySelectorAll('.entry');
          const releases = [];

          entries.forEach(entry => {
            // Get NFO data
            const nfoContent = entry.querySelector('.nfo pre')?.textContent || '';
            const quality = entry.querySelector('.audiotag:first-child')?.textContent.match(/\d+p/) || ['unknown'];
            
            // Fixed size selector
            const sizeElement = Array.from(entry.querySelectorAll('.audiotag small'))
              .find(el => el.textContent === 'Größe:');
            const size = sizeElement?.nextSibling?.textContent.trim() || 'unknown';
            
            // Get download links for this release
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

          return {
            releases,
            totalReleases: releases.length
          };
        });

        console.log(`\n=== Scraping Results ===`);
        console.log(`📊 Total releases found: ${downloadData.totalReleases}`);
        console.log(`📊 Page URL: ${targetUrl}\n`);

        // Update the response to include the detailed data
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
      console.error('\n❌ Error during scraping:', {
        message: error.message,
        stage: error.stage || 'Unknown stage',
        url: targetUrl
      });
      
      res.status(500).json({
        success: false,
        error: error.message,
        tmdb_id,
        url: targetUrl
      });
    } finally {
      console.log('\n🧹 Cleaning up resources...');
      if (page) {
        await page.close();
        console.log('✅ Page closed');
      }
      if (browser) {
        await browser.close();
        console.log('✅ Browser closed');
      }
      console.log('=== Scraping Process Complete ===\n');
    }
  }
};