// utils/proxy-integration.js
import proxyManager from './proxy-manager.js';
import { browserOptions } from './browser.js';

export function getProxyEnabledBrowserOptions() {
    const proxy = proxyManager.getNextProxy();
    return {
        ...browserOptions,
        args: [
            ...browserOptions.args,
            ...proxyManager.getPuppeteerArgs(proxy)
        ]
    };
}

export async function withProxy(fetchFn) {
    const proxy = proxyManager.getNextProxy();
    console.log(`🌐 Using proxy: ${proxy.protocol}://${proxy.host}:${proxy.port}`);
    try {
        const result = await fetchFn(proxyManager.getFetchConfig(proxy));
        console.log(`✅ Proxy request successful: ${proxy.host}`);
        proxyManager.markProxySuccess(proxy);
        return result;
    } catch (error) {
        console.log(`❌ Proxy request failed: ${proxy.host}`);
        proxyManager.markProxyFailure(proxy);
        throw error;
    }
}