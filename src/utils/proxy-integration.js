// utils/proxy-integration.js
import proxyManager from './proxy-manager.js';
import { browserOptions } from './browser.js';

// Maximum number of proxy attempts before giving up
const MAX_PROXY_ATTEMPTS = 5;

export async function getProxyEnabledBrowserOptions() {
    try {
        // Try to find a working proxy specifically for browser usage
        const proxy = await findWorkingBrowserProxy();
        
        return {
            ...browserOptions,
            args: [
                ...browserOptions.args,
                ...proxyManager.getPuppeteerArgs(proxy)
            ]
        };
    } catch (error) {
        console.warn(`⚠️ Could not find working proxy for browser: ${error.message}`);
        console.warn('⚠️ Proceeding without proxy...');
        
        // Return browser options without proxy if no working proxy found
        return browserOptions;
    }
}

export async function withProxy(fetchFn, attemptCount = 0) {
    // If we've tried too many times, throw a more descriptive error
    if (attemptCount >= MAX_PROXY_ATTEMPTS) {
        throw new Error(`Failed after ${MAX_PROXY_ATTEMPTS} proxy attempts. Consider checking proxy list validity.`);
    }

    const proxy = proxyManager.getNextProxy();
    console.log(`🌐 Using proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
    
    try {
        const result = await fetchFn(proxyManager.getFetchConfig(proxy));
        console.log(`✅ Proxy request successful: ${proxy.host}`);
        proxyManager.markProxySuccess(proxy);
        return result;
    } catch (error) {
        console.log(`❌ Proxy request failed: ${proxy.host} - ${error.message || 'Unknown error'}`);
        proxyManager.markProxyFailure(proxy);
        
        // For connection errors, try another proxy automatically
        if (error.message && (
            error.message.includes('ECONNREFUSED') || 
            error.message.includes('ETIMEDOUT') || 
            error.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
            error.message.includes('socket hang up')
        )) {
            console.log(`🔄 Automatically retrying with a different proxy (attempt ${attemptCount + 1}/${MAX_PROXY_ATTEMPTS})...`);
            return withProxy(fetchFn, attemptCount + 1);
        }
        
        throw error;
    }
}

// Updated function to test proxies before using them
export async function testProxy(proxy) {
    try {
        console.log(`🧪 Testing proxy ${proxy.host}:${proxy.port} against httpbin.org...`);
        
        // Use node-fetch or similar for direct HTTP requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        // Use HTTP endpoint for testing, not HTTPS
        const response = await fetch('http://httpbin.org/ip', {
            signal: controller.signal,
            ...proxyManager.getFetchConfig(proxy)
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Proxy test successful: ${proxy.host} (IP: ${data.origin})`);
            return true;
        }
        
        console.log(`❌ Proxy test failed: ${proxy.host} (Status: ${response.status})`);
        return false;
    } catch (error) {
        console.log(`❌ Proxy test error: ${proxy.host} - ${error.message}`);
        return false;
    }
}

// New function to find a working proxy
export async function findWorkingProxy(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const proxy = proxyManager.getNextProxy();
        console.log(`🔍 Testing proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
        
        const isWorking = await testProxy(proxy);
        
        if (isWorking) {
            console.log(`✅ Found working proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
            return proxy;
        } else {
            console.log(`❌ Proxy test failed: ${proxy.host}`);
            proxyManager.markProxyFailure(proxy);
        }
    }
    
    throw new Error(`Could not find a working proxy after ${maxAttempts} attempts`);
}

// New function to test proxies specifically for browser usage
export async function testProxyWithBrowser(proxy) {
    const puppeteer = await import('puppeteer');
    
    try {
        console.log(`🧪 Testing browser proxy ${proxy.host}:${proxy.port}...`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                ...proxyManager.getPuppeteerArgs(proxy),
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            timeout: 30000
        });
        
        const page = await browser.newPage();
        await page.goto('http://httpbin.org/ip', { timeout: 15000 });
        
        const content = await page.content();
        await browser.close();
        
        if (content.includes(proxy.host)) {
            console.log(`✅ Browser proxy test successful: ${proxy.host}`);
            return true;
        } else {
            console.log(`❌ Browser proxy test failed: ${proxy.host} (IP not found in response)`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Browser proxy test error: ${proxy.host} - ${error.message}`);
        return false;
    }
}

// Improved function to find a working proxy for browser usage
export async function findWorkingBrowserProxy(maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
        const proxy = proxyManager.getNextProxy();
        console.log(`🔍 Testing browser proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
        
        const isWorking = await testProxyWithBrowser(proxy);
        
        if (isWorking) {
            console.log(`✅ Found working browser proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
            return proxy;
        } else {
            console.log(`❌ Browser proxy test failed: ${proxy.host}`);
            proxyManager.markProxyFailure(proxy);
        }
    }
    
    throw new Error(`Could not find a working browser proxy after ${maxAttempts} attempts`);
}