// utils/proxy-manager.js
import _ from 'lodash';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

class ProxyManager {
    constructor() {
        // Initialize proxy list with the provided proxies
        this.proxies = [
            { host: '62.182.83.214', port: 1080, protocol: 'socks5' },
            { host: '132.148.167.243', port: 44728, protocol: 'socks5' },
            { host: '132.148.167.243', port: 46609, protocol: 'socks5' },
            { host: '132.148.167.243', port: 44585, protocol: 'socks5' },
            { host: '98.8.195.160', port: 443, protocol: 'http' },
            { host: '132.148.167.243', port: 16444, protocol: 'socks5' },
            { host: '132.148.167.243', port: 18975, protocol: 'socks5' },
            { host: '64.202.184.249', port: 6282, protocol: 'socks5' },
            { host: '64.202.184.249', port: 7652, protocol: 'socks5' },
            { host: '132.148.167.243', port: 62859, protocol: 'socks5' },
            { host: '132.148.167.243', port: 48451, protocol: 'socks5' },
            { host: '64.202.184.249', port: 31239, protocol: 'socks5' },
            { host: '132.148.167.243', port: 46843, protocol: 'socks5' },
            { host: '5.78.124.10', port: 7654, protocol: 'socks5' },
            { host: '132.148.167.243', port: 30241, protocol: 'socks5' },
            { host: '132.148.167.243', port: 28382, protocol: 'socks5' },
            { host: '132.148.167.243', port: 57413, protocol: 'socks5' },
            { host: '51.83.66.117', port: 36798, protocol: 'socks5' },
            { host: '98.152.200.61', port: 8081, protocol: 'socks5' },
            { host: '132.148.167.243', port: 40303, protocol: 'socks5' },
            { host: '132.148.167.243', port: 53911, protocol: 'socks5' },
            { host: '132.148.167.243', port: 30510, protocol: 'socks5' },
            { host: '132.148.167.243', port: 44945, protocol: 'socks5' },
            { host: '87.107.69.5', port: 9999, protocol: 'http' },
            { host: '132.148.167.243', port: 44970, protocol: 'socks5' },
            { host: '130.162.180.254', port: 8888, protocol: 'http' },
            { host: '200.174.198.86', port: 8888, protocol: 'http' },
            { host: '36.103.179.194', port: 8088, protocol: 'http' },
            { host: '45.77.168.215', port: 45613, protocol: 'http' },
            { host: '50.63.12.101', port: 59998, protocol: 'socks5' },
            { host: '184.168.121.153', port: 64744, protocol: 'socks5' },
            { host: '184.168.121.153', port: 48636, protocol: 'socks5' },
            { host: '184.168.121.153', port: 29660, protocol: 'socks5' },
            { host: '184.168.121.153', port: 47137, protocol: 'socks5' },
            { host: '184.168.121.153', port: 17249, protocol: 'socks5' },
            { host: '184.168.121.153', port: 8538, protocol: 'socks5' },
            { host: '184.168.121.153', port: 49562, protocol: 'socks5' },
            { host: '67.43.227.226', port: 26557, protocol: 'http' },
            { host: '67.43.227.226', port: 23939, protocol: 'http' },
            { host: '184.168.121.153', port: 62648, protocol: 'socks5' },
            { host: '135.148.32.193', port: 58359, protocol: 'socks5' },
            { host: '184.170.245.134', port: 54968, protocol: 'socks5' },
            { host: '50.63.12.101', port: 54885, protocol: 'socks5' },
            { host: '208.89.96.187', port: 33139, protocol: 'socks5' },
            { host: '72.10.164.178', port: 19155, protocol: 'http' },
            { host: '68.178.203.148', port: 39041, protocol: 'socks5' },
            { host: '162.241.73.195', port: 45130, protocol: 'socks5' },
            { host: '208.89.96.187', port: 36575, protocol: 'socks5' },
            { host: '184.168.121.153', port: 14013, protocol: 'socks5' },
            { host: '27.79.140.38', port: 16000, protocol: 'http' }
        ];        

        this.currentIndex = 0;
        this.lastRotation = Date.now();
        this.proxyHealth = new Map();
        
        // Initialize health status for all proxies
        this.proxies.forEach(proxy => {
            this.proxyHealth.set(`${proxy.host}:${proxy.port}`, {
                failures: 0,
                lastUsed: null,
                blacklistedUntil: null
            });
        });
    }

    getProxyString(proxy) {
        return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    }

    markProxyFailure(proxy) {
        const key = `${proxy.host}:${proxy.port}`;
        const health = this.proxyHealth.get(key);
        health.failures += 1;
        
        if (health.failures >= 3) {
            // Blacklist proxy for 5 minutes after 3 failures
            health.blacklistedUntil = Date.now() + 5 * 60 * 1000;
            health.failures = 0;
        }
        
        this.proxyHealth.set(key, health);
    }

    markProxySuccess(proxy) {
        const key = `${proxy.host}:${proxy.port}`;
        const health = this.proxyHealth.get(key);
        health.failures = 0;
        this.proxyHealth.set(key, health);
    }

    getNextProxy() {
        const now = Date.now();
        
        // Filter out blacklisted proxies
        const availableProxies = this.proxies.filter(proxy => {
            const health = this.proxyHealth.get(`${proxy.host}:${proxy.port}`);
            return !health.blacklistedUntil || health.blacklistedUntil < now;
        });

        if (availableProxies.length === 0) {
            console.warn('No healthy proxies available, resetting all proxies');
            this.proxyHealth.forEach(health => {
                health.blacklistedUntil = null;
                health.failures = 0;
            });
            return this.proxies[0];
        }

        // Rotate through available proxies
        this.currentIndex = (this.currentIndex + 1) % availableProxies.length;
        const proxy = availableProxies[this.currentIndex];
        
        // Update last used timestamp
        const health = this.proxyHealth.get(`${proxy.host}:${proxy.port}`);
        health.lastUsed = now;
        this.proxyHealth.set(`${proxy.host}:${proxy.port}`, health);

        console.log(`🔄 Rotating to proxy: ${proxy.host} (Protocol: ${proxy.protocol})`);
        console.log(`📊 Proxy health status: ${this.proxyHealth.get(`${proxy.host}:${proxy.port}`).failures} failures`);
        
        return proxy;
    }

    getPuppeteerArgs(proxy) {
        return [
            `--proxy-server=${this.getProxyString(proxy)}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ];
    }

    getAxiosConfig(proxy) {
        return {
            proxy: {
                host: proxy.host,
                port: proxy.port,
                protocol: proxy.protocol
            },
            timeout: 10000
        };
    }

    getFetchConfig(proxy) {
        return {
            agent: new (proxy.protocol === 'http' ? HttpProxyAgent : SocksProxyAgent)(
                this.getProxyString(proxy)
            )
        };
    }
}

// Create singleton instance
const proxyManager = new ProxyManager();
export default proxyManager;