import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { browserOptions, createStealthPage } from '../utils/browser.js';
import { getProxyEnabledBrowserOptions } from '../utils/proxy-integration.js';

// Ensure stealth plugin is registered
puppeteer.use(StealthPlugin());

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

      // Modify browser options to ignore SSL errors
      const browserOpts = getProxyEnabledBrowserOptions();
      browserOpts.ignoreHTTPSErrors = true;  // Add this to ignore SSL errors
      
      // Add retries for launch
      let retries = 3;
      while (retries > 0) {
        try {
          browser = await puppeteer.launch(browserOpts);
          break;
        } catch (err) {
          retries--;
          if (retries === 0) throw err;
          console.log(`Browser launch failed, retrying... (${retries} attempts left)`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
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
      await page.setViewport({ width: 1280, height: 900 }); // Larger viewport may help with responsive content
      await page.setDefaultNavigationTimeout(30000); // Increase timeout for navigation
      
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

      // Add more human-like behavior
      await page.evaluateOnNewDocument(() => {
        // Override the navigator properties
        const newProto = navigator.__proto__;
        delete newProto.webdriver;
        navigator.__proto__ = newProto;
        
        // Add a fake user interaction
        if (!window.didMouseMove) {
          window.didMouseMove = true;
          const dispatchMouseEvent = (type, x, y) => {
            const evt = document.createEvent('MouseEvents');
            evt.initMouseEvent(type, true, true, window, 0, 0, 0, x, y, false, false, false, false, 0, null);
            document.dispatchEvent(evt);
          };
          
          setTimeout(() => {
            dispatchMouseEvent('mousemove', 100, 100);
            dispatchMouseEvent('mousemove', 200, 200);
          }, 1000);
        }
      });

      // Improved navigation with retry mechanism
      const maxNavigationRetries = 3;
      let navigationRetries = 0;
      let navigationSuccessful = false;

      while (!navigationSuccessful && navigationRetries < maxNavigationRetries) {
        try {
          await page.goto(targetUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 // Increased timeout
          });
          navigationSuccessful = true;
        } catch (err) {
          navigationRetries++;
          console.log(`Navigation attempt ${navigationRetries} failed: ${err.message}`);
          if (navigationRetries >= maxNavigationRetries) throw err;
          await new Promise(r => setTimeout(r, 2000)); // Wait before retrying
        }
      }

      // Wait for content with multiple selector options and longer timeout
      const contentSelectors = [
        '.review-view-rate',
        'button.rating--interactive',
        '.rating__age',
        '.content-grid-content',
        '.rating__label'
      ];
      
      let contentFound = false;
      for (const selector of contentSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          contentFound = true;
          console.log(`Found selector: ${selector}`);
          break;
        } catch (err) {
          console.log(`Selector ${selector} not found, trying next one...`);
        }
      }
      
      if (!contentFound) {
        throw new Error('Could not find any content selectors on the page');
      }
      
      // Add a small delay to ensure page is fully loaded
      await new Promise(r => setTimeout(r, 2000));

      // Enhanced data extraction with fallbacks
      const ratingData = await page.evaluate(() => {
        const getTextContent = selector => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : null;
        };

        // Dynamic category extraction with fallbacks
        const getAllRatingDetails = () => {
            const details = {};
            
            // Try the interactive buttons first
            const ratingButtons = Array.from(document.querySelectorAll('button.rating--interactive'));
            
            if (ratingButtons.length > 0) {
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
            } else {
                // Fallback to other rating elements
                const ratingItems = Array.from(document.querySelectorAll('.content-grid-content'));
                ratingItems.forEach(item => {
                    const label = item.querySelector('h3')?.textContent?.trim();
                    if (label) {
                        const categoryKey = label.toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_')
                            .replace(/_+/g, '_')
                            .replace(/^_|_$/g, '');
                        
                        details[categoryKey] = {
                            label: label,
                            rating: item.querySelector('.content-grid-content')?.textContent?.trim() || null,
                            description: item.querySelector('p')?.textContent?.trim() || null,
                            score: item.querySelectorAll('.csm-icon-filled').length || 0
                        };
                    }
                });
            }
            
            return details;
        };

        // Try multiple selectors for age rating
        const getAgeRating = () => {
            const selectors = ['.rating__age', '.parent-review-at-a-glance-age', '.age-tag'];
            for (const selector of selectors) {
                const content = getTextContent(selector);
                if (content) return content;
            }
            return null;
        };

        // Try multiple selectors for summary
        const getSummary = () => {
            const selectors = [
                '.review-view-summary-oneliner', 
                '.parent-review-at-a-glance-movie-desciption', 
                '.review-title + p'
            ];
            for (const selector of selectors) {
                const content = getTextContent(selector);
                if (content) return content;
            }
            return null;
        };

        return {
            ageRating: getAgeRating(),
            summary: getSummary(),
            parentsGuide: getTextContent('.paragraph-inline p') || getTextContent('.parent-review-content p'),
            details: getAllRatingDetails(),
            pageTitle: document.title
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
      try {
        if (page) await page.close().catch(e => console.error('Error closing page:', e));
        if (browser) await browser.close().catch(e => console.error('Error closing browser:', e));
      } catch (closeError) {
        console.error('Error during cleanup:', closeError);
      }
    }
  }
};
