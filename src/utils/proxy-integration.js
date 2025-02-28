// utils/proxy-integration.js
import proxyManager from './proxy-manager.js';
import { browserOptions } from './browser.js';

export function getProxyEnabledBrowserOptions() {
    const proxy = proxyManager.getNextProxy();
    return {
        ...browserOptions,
        args: [
            ...browserOptions.args,
            ...(proxy ? proxyManager.getPuppeteerArgs(proxy) : [])
        ],
        // Increase timeout for browser operations
        timeout: 30000
    };
}

export async function withProxy(fetchFn, config = {}) {
    // Try up to 3 different proxies before giving up
    const maxRetries = 3;
    let lastError = null;
    let attemptedProxies = new Set();
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const proxy = proxyManager.getNextProxy();
        
        // If we've already tried this proxy or no proxy is available, skip
        if (!proxy || attemptedProxies.has(`${proxy.host}:${proxy.port}`)) {
            if (attempt === 0) {
                console.log('⚠️ No suitable proxy available, proceeding without proxy');
                try {
                    return await fetchFn(config);
                } catch (error) {
                    lastError = error;
                    console.log(`❌ Direct request failed: ${error.message}`);
                    continue; // Try with a proxy on next attempt
                }
            }
            continue; // Try to get a different proxy
        }
        
        // Track this proxy so we don't use it again in this request
        attemptedProxies.add(`${proxy.host}:${proxy.port}`);
        
        console.log(`🌐 [Attempt ${attempt + 1}/${maxRetries}] Using proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
        
        try {
            // Merge any provided config with the proxy config
            const mergedConfig = { 
                ...config, 
                ...proxyManager.getFetchConfig(proxy),
                // Ensure we have a reasonable timeout
                timeout: config.timeout || 20000 // Increased timeout
            };
            
            const result = await fetchFn(mergedConfig);
            console.log(`✅ Proxy request successful: ${proxy.host}`);
            proxyManager.markProxySuccess(proxy);
            return result;
        } catch (error) {
            lastError = error;
            console.log(`❌ Proxy request failed: ${proxy.host} - ${error.message}`);
            proxyManager.markProxyFailure(proxy);
            
            // If it's a timeout error, we'll try another proxy
            if (error.message.includes('timeout') || 
                error.message.includes('socket hang up') ||
                error.message.includes('ECONNRESET') ||
                error.message.includes('ETIMEDOUT')) {
                console.log('Timeout detected, will try another proxy');
                continue;
            }
            
            // For navigation errors in Puppeteer, try another proxy
            if (error.message.includes('Navigation timeout') ||
                error.message.includes('net::ERR_') ||
                error.message.includes('Target closed') ||
                error.message.includes('Session closed')) {
                console.log('Navigation or session error detected, will try another proxy');
                continue;
            }
            
            // For other errors, if we have more retries, continue
            if (attempt < maxRetries - 1) {
                continue;
            }
            
            // Otherwise, throw the error
            throw error;
        }
    }
    
    // If we've exhausted all retries, throw the last error
    throw lastError || new Error('Failed after multiple proxy attempts');
}