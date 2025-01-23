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
      
      // Dynamic URL based on content type
      targetUrl = type === 'movie' 
        ? `https://www.commonsensemedia.org/movie-reviews/${formattedTitle}`
        : `https://www.commonsensemedia.org/tv-reviews/${formattedTitle}`;
      
      console.log('🔍 Scraping URL:', targetUrl);

      browser = await puppeteer.launch(getProxyEnabledBrowserOptions());
      page = await createStealthPage(browser);
      await page.setDefaultNavigationTimeout(60000);

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      console.log('⏳ Navigating to page...');
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // Wait for content to load
      await page.waitForSelector('.review-view-rate, button.rating--interactive', { timeout: 30000 });

      console.log('📝 Extracting rating data...');
      const ratingData = await page.evaluate(() => {
        const getTextContent = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : null;
        };

        const getRatingDetails = (category) => {
            // Find the button containing this category
            const button = Array.from(document.querySelectorAll('button.rating--interactive')).find(btn => 
                btn.querySelector('.rating__label')?.textContent.trim().toLowerCase().includes(category.toLowerCase())
            );
              
            if (!button) return null;

            // Get the parent div that contains the data-text attribute
            const parentDiv = button.closest('.content-grid-content');
              
            return {
                rating: parentDiv?.getAttribute('data-text')?.replace(/<\/?p>/g, '').trim() || null,
                description: button.querySelector('.rating__teaser')?.textContent.trim() || null,
                score: Array.from(button.querySelectorAll('.rating__score i.active')).length || 0
            };
        };

        const parentsGuide = document.querySelector('.paragraph-inline p')?.textContent.trim();

        return {
            ageRating: getTextContent('.rating__age'),
            summary: getTextContent('.review-view-summary-oneliner'),
            parentsGuide: parentsGuide,
            details: {
                sex: getRatingDetails('Sex'),
                violence: getRatingDetails('Violence'),
                language: getRatingDetails('Language'),
                drugs: getRatingDetails('Drinking'),
                consumerism: getRatingDetails('Products'),
                positiveMessages: getRatingDetails('Positive Messages'),
                roleModels: getRatingDetails('Role Models'),
                diversity: getRatingDetails('Diverse')
            }
        };
    });
      console.log('✅ Data extracted successfully');
      
      res.json({
        success: true,
        type,
        title,
        scraped_url: targetUrl,
        rating: ratingData
      });

    } catch (error) {
      console.error('❌ Scraping failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        type,
        title,
        url: targetUrl
      });
    } finally {
      if (page) {
        console.log('🔒 Closing page...');
        await page.close();
      }
      if (browser) {
        console.log('🔒 Closing browser...');
        await browser.close();
      }
    }
  }
};
