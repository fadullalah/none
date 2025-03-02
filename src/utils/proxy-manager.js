// utils/proxy-manager.js
import _ from 'lodash';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

class ProxyManager {
    constructor() {
        // Initialize with empty proxy list - will be populated automatically
        this.proxies = [];
        this.currentIndex = 0;
        this.lastRotation = Date.now();
        this.proxyHealth = new Map();
        this.lastProxyUpdate = 0;
        this.proxyUpdateInterval = 30 * 60 * 1000; // 30 minutes
        this.isUpdatingProxies = false;
        this.proxyTestUrl = 'https://www.google.com';
        this.proxyTestTimeout = 3000; // 3 seconds
        
        // Fetch proxies on initialization
        this.updateProxyList().catch(err => {});
    }

    getProxyString(proxy) {
        return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    }

    markProxyFailure(proxy) {
        if (!proxy) return;
        
        const key = `${proxy.host}:${proxy.port}`;
        const health = this.proxyHealth.get(key) || { failures: 0, lastUsed: null, blacklistedUntil: null };
        health.failures += 1;
        
        if (health.failures >= 2) { // Reduced threshold to 2 failures
            // Blacklist proxy for 10 minutes after 2 failures
            health.blacklistedUntil = Date.now() + 10 * 60 * 1000;
            health.failures = 0;
        }
        
        this.proxyHealth.set(key, health);
    }

    markProxySuccess(proxy) {
        if (!proxy) return;
        
        const key = `${proxy.host}:${proxy.port}`;
        const health = this.proxyHealth.get(key) || { failures: 0, lastUsed: null, blacklistedUntil: null };
        health.failures = 0;
        health.successCount = (health.successCount || 0) + 1;
        this.proxyHealth.set(key, health);
    }

    /**
     * Test if a proxy is working
     * @param {Object} proxy - Proxy object with host, port, and protocol
     * @returns {Promise<boolean>} - Whether the proxy is working
     */
    async testProxy(proxy) {
        try {
            const proxyUrl = this.getProxyString(proxy);
            const agent = proxy.protocol === 'http' 
                ? new HttpProxyAgent(proxyUrl)
                : new SocksProxyAgent(proxyUrl);
                
            const response = await axios.get(this.proxyTestUrl, {
                httpsAgent: agent,
                timeout: this.proxyTestTimeout,
                proxy: false,
                validateStatus: () => true // Accept any status code
            });
            
            // Only consider it working if we get a 200 status code
            return response.status === 200;
        } catch (error) {
            return false; // Proxy doesn't work
        }
    }

    /**
     * Fetch proxies from multiple sources
     */
    async updateProxyList() {
        const now = Date.now();
        
        // Skip if already updating or if the cache isn't expired
        if (this.isUpdatingProxies || 
            (now - this.lastProxyUpdate < this.proxyUpdateInterval && this.proxies.length > 5)) {
            return;
        }
        
        this.isUpdatingProxies = true;
        
        try {
            // Use multiple reliable proxy sources
            const sources = [
                { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', protocol: 'http' },
                { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt', protocol: 'http' },
                { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt', protocol: 'http' },
                { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks4.txt', protocol: 'socks4' },
                { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt', protocol: 'socks5' },
                { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', protocol: 'http' },
                { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt', protocol: 'socks4' },
                { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt', protocol: 'socks5' },
                { url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', protocol: 'socks5' },
                { url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt', protocol: 'http' }
            ];

            const newProxies = [];
            for (const source of sources) {
                try {
                    const response = await axios.get(source.url, { timeout: 5000 });
                    const text = response.data;
                    
                    // Extract proxies using regex
                    const matches = text.match(/\d+\.\d+\.\d+\.\d+:\d+/g);
                    if (matches) {
                        const sourceProxies = matches.map(match => {
                            const [host, port] = match.split(':');
                            return { host, port: parseInt(port), protocol: source.protocol };
                        });
                        
                        newProxies.push(...sourceProxies);
                    }
                } catch (error) {
                    // Failed to fetch proxies from source
                }
            }

            if (newProxies.length > 0) {
                // Test more proxies for better reliability
                const maxProxiesToTest = 30; // Increased from 15
                const proxiesToTest = newProxies
                    .sort(() => 0.5 - Math.random()) // Shuffle array
                    .slice(0, maxProxiesToTest);
                
                // Test proxies in parallel with short timeout
                const testPromises = proxiesToTest.map(proxy => {
                    return Promise.race([
                        this.testProxy(proxy).then(works => ({ proxy, works })),
                        new Promise(resolve => setTimeout(() => resolve({ proxy, works: false }), 2500))
                    ]);
                });
                
                const results = await Promise.all(testPromises);
                const workingProxies = results
                    .filter(result => result.works)
                    .map(result => result.proxy);
                
                // Add working proxies to our list
                if (workingProxies.length > 0) {
                    // Initialize health status for new proxies
                    workingProxies.forEach(proxy => {
                        const key = `${proxy.host}:${proxy.port}`;
                        if (!this.proxyHealth.has(key)) {
                            this.proxyHealth.set(key, {
                                failures: 0,
                                lastUsed: null,
                                blacklistedUntil: null,
                                successCount: 0
                            });
                        }
                    });
                    
                    // Replace the proxy list with working proxies
                    this.proxies = workingProxies;
                    this.lastProxyUpdate = now;
                    
                    // Reset the current index
                    this.currentIndex = 0;
                } else if (this.proxies.length === 0) {
                    // If we didn't find any working proxies and don't have any, try a few untested ones
                    const untested = newProxies
                        .sort(() => 0.5 - Math.random()) // Shuffle
                        .slice(0, 10); // Take 10 random proxies
                    
                    // Initialize health status for untested proxies
                    untested.forEach(proxy => {
                        const key = `${proxy.host}:${proxy.port}`;
                        this.proxyHealth.set(key, {
                            failures: 0,
                            lastUsed: null,
                            blacklistedUntil: null,
                            successCount: 0
                        });
                    });
                    
                    this.proxies = untested;
                }
            }
        } catch (error) {
            // Error updating proxy list
        } finally {
            this.isUpdatingProxies = false;
        }
    }

    getNextProxy() {
        const now = Date.now();
        
        // Check if we need to update proxies
        if (now - this.lastProxyUpdate > this.proxyUpdateInterval || this.proxies.length < 3) {
            // Start proxy update in background but don't wait for it
            this.updateProxyList().catch(err => {});
        }
        
        // Filter out blacklisted proxies
        const availableProxies = this.proxies.filter(proxy => {
            const key = `${proxy.host}:${proxy.port}`;
            const health = this.proxyHealth.get(key);
            return health && (!health.blacklistedUntil || health.blacklistedUntil < now);
        });

        if (availableProxies.length === 0) {
            // Reset blacklist status for all proxies
            this.proxyHealth.forEach((health, key) => {
                health.blacklistedUntil = null;
            });
            
            // Try again with reset blacklist
            const resetProxies = this.proxies.filter(proxy => {
                const key = `${proxy.host}:${proxy.port}`;
                return this.proxyHealth.has(key);
            });
            
            if (resetProxies.length === 0) {
                // Force an immediate proxy update
                this.lastProxyUpdate = 0;
                this.updateProxyList().catch(err => {});
                return null;
            }
            
            // Sort by least failures
            resetProxies.sort((a, b) => {
                const healthA = this.proxyHealth.get(`${a.host}:${a.port}`);
                const healthB = this.proxyHealth.get(`${b.host}:${b.port}`);
                return (healthA?.failures || 0) - (healthB?.failures || 0);
            });
            
            return resetProxies[0];
        }

        // Sort proxies by success count (prioritize proven reliable proxies)
        availableProxies.sort((a, b) => {
            const healthA = this.proxyHealth.get(`${a.host}:${a.port}`);
            const healthB = this.proxyHealth.get(`${b.host}:${b.port}`);
            return (healthB?.successCount || 0) - (healthA?.successCount || 0);
        });
        
        // Use a weighted random selection that favors proxies with higher success rates
        const totalProxies = availableProxies.length;
        const weightedIndex = Math.floor(Math.pow(Math.random(), 2) * totalProxies);
        const proxy = availableProxies[weightedIndex];
        
        // Update last used timestamp
        const key = `${proxy.host}:${proxy.port}`;
        const health = this.proxyHealth.get(key);
        if (health) {
            health.lastUsed = now;
            this.proxyHealth.set(key, health);
        }
        
        return proxy;
    }

    getPuppeteerArgs(proxy) {
        if (!proxy) return ['--no-sandbox', '--disable-setuid-sandbox'];
        
        return [
            `--proxy-server=${this.getProxyString(proxy)}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ];
    }

    getAxiosConfig(proxy) {
        if (!proxy) return { timeout: 10000 };
        
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
        if (!proxy) return {};
        
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