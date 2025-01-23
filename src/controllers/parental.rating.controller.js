import puppeteer from 'puppeteer-extra';
import { browserOptions, createStealthPage } from '../utils/browser.js';
import { getProxyEnabledBrowserOptions } from '../utils/proxy-integration.js';

export const parentalRatingController = {
  async getParentalRating(req, res) {
    const { type, title } = req.params;
    let browser = null;
    let page = null;
    let targetUrl = '';

    try {
      const formattedTitle = title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      targetUrl = type === 'movie' 
        ? `https://www.commonsensemedia.org/movie-reviews/${formattedTitle}`
        : `https://www.commonsensemedia.org/tv-reviews/${formattedTitle}`;
      
      console.log('🚀 Speed-scraping URL:', targetUrl);

      browser = await puppeteer.launch(getProxyEnabledBrowserOptions());
      page = await createStealthPage(browser);

      // Turbo mode configurations
      await page.setRequestInterception(true);
      page.on('request', request => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        // Only allow essential requests
        if (
          resourceType === 'document' ||
          (resourceType === 'script' && url.includes('commonsensemedia.org')) ||
          (resourceType === 'xhr' && url.includes('api'))
        ) {
          request.continue();
        } else {
          request.abort();
        }
      });

      // Performance optimizations
      await page.setViewport({ width: 800, height: 600 });
      await page.setDefaultNavigationTimeout(15000);
      
      // Disable heavy browser features
      await page.evaluateOnNewDocument(() => {
        window.analytics = null;
        window.google_analytics = null;
        window.ga = null;
        window._gaq = null;
        window.dataLayer = null;
        window.optimizely = null;
        window.WebFont = null;
      });

      // Parallel loading strategy
      const navigationPromise = page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 8000 
      });

      const selectorPromise = Promise.race([
        page.waitForSelector('.review-view-rate', { timeout: 5000 }),
        page.waitForSelector('button.rating--interactive', { timeout: 5000 })
      ]);

      await Promise.all([navigationPromise, selectorPromise]);
      // Quick data extraction
      const ratingData = await page.evaluate(() => {
        const getTextContent = selector => document.querySelector(selector)?.textContent?.trim() || null;

        // Dynamic category extraction
        const getAllRatingDetails = () => {
            const details = {};
            const ratingButtons = Array.from(document.querySelectorAll('button.rating--interactive'));
            
            ratingButtons.forEach(button => {
                const label = button.querySelector('.rating__label')?.textContent?.trim();
                if (label) {
                    const categoryKey = label.toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/_+/g, '_')
                        .replace(/^_|_$/g, '');
                    
                    const parentDiv = button.closest('.content-grid-content');
                    details[categoryKey] = {
                        label: label,
                        rating: parentDiv?.getAttribute('data-text')?.replace(/<\/?p>/g, '').trim() || null,
                        description: button.querySelector('.rating__teaser')?.textContent?.trim() || null,
                        score: button.querySelectorAll('.rating__score i.active').length || 0
                    };
                }
            });
            
            return details;
        };

        return {
            ageRating: getTextContent('.rating__age'),
            summary: getTextContent('.review-view-summary-oneliner'),
            parentsGuide: getTextContent('.paragraph-inline p'),
            details: getAllRatingDetails()
        };
      });
      console.log('⚡ Data extracted at light speed');
      
      res.json({
        success: true,
        type,
        title,
        scraped_url: targetUrl,
        rating: ratingData
      });

    } catch (error) {
      console.error('❌ Speed scraping failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        type,
        title,
        url: targetUrl
      });
    } finally {
      if (page) await page.close();
      if (browser) await browser.close();
    }
  }
};
