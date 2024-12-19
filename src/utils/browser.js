import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export const browserOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-gpu',
    '--window-position=-32000,-32000'
  ],
  ignoreDefaultArgs: ['--enable-automation']
};

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function customNavigate(page, url, maxRedirects = 5) {
  try {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount < maxRedirects) {
      const response = await page.goto(currentUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      const newUrl = response.url();
      if (newUrl === currentUrl || newUrl === 'about:blank') {
        break;
      }

      currentUrl = newUrl;
      redirectCount++;
      await delay(1000);
    }

    return currentUrl;
  } catch (error) {
    console.error('Navigation error:', error);
    throw error;
  }
}