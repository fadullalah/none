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
    // First try with proxy
    try {
        const proxy = proxyManager.getNextProxy();
        const result = await fetchFn(proxyManager.getFetchConfig(proxy));
        proxyManager.markProxySuccess(proxy);
        return result;
    } catch (error) {
        // On proxy failure, try direct connection
        console.log('Proxy failed, attempting direct connection...');
        return await fetchFn({});
    }
}