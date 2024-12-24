import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export const browserOptions = {
  headless: true,
  defaultViewport: null,
  slowMo: 100,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-blink-features=AutomationControlled',
    '--hide-scrollbars',
    '--mute-audio',
    '--start-maximized',
    '--window-size=1920,1080'
  ],
  ignoreDefaultArgs: ['--enable-automation']
};

export async function customNavigate(page, url, maxRedirects = 3) {
  let currentUrl = url;
  let redirectCount = 0;

  console.log(`[Navigation] Starting navigation to: ${url}`);

  // Enable request logging
  await page.setRequestInterception(true);
  page.on('request', request => {
    console.log(`[Request] ${request.method()} ${request.url()}`);
    request.continue();
  });

  page.on('response', response => {
    console.log(`[Response] ${response.status()} ${response.url()}`);
  });

  while (redirectCount < maxRedirects) {
    console.log(`[Navigation] Attempt ${redirectCount + 1}/${maxRedirects}`);
    
    const response = await page.goto(currentUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    const newUrl = response.url();
    console.log(`[Navigation] Current URL: ${newUrl}`);
    
    if (newUrl === currentUrl || newUrl === 'about:blank') break;

    currentUrl = newUrl;
    redirectCount++;
    
    await page.waitForTimeout(1000); // Small delay between redirects
  }

  console.log(`[Navigation] Completed at: ${currentUrl}`);
  return currentUrl;
}