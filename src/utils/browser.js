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
    '--disable-gpu'
  ],
  ignoreDefaultArgs: ['--enable-automation']
};

export async function customNavigate(page, url, maxRedirects = 3) {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < maxRedirects) {
    const response = await page.goto(currentUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    const newUrl = response.url();
    if (newUrl === currentUrl || newUrl === 'about:blank') break;

    currentUrl = newUrl;
    redirectCount++;
  }

  return currentUrl;
}