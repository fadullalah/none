// utils/proxy-manager.js
import _ from 'lodash';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

class ProxyManager {
    constructor() {
        // Initialize proxy list with the provided proxies
        this.proxies = [
            { host: '203.19.38.114', port: 1080, protocol: 'http' },
            { host: '103.49.202.252', port: 80, protocol: 'http' },
            { host: '47.83.192.255', port: 8888, protocol: 'http' },
            { host: '80.249.112.162', port: 80, protocol: 'http' },
            { host: '23.88.116.40', port: 80, protocol: 'http' },
            { host: '149.129.226.9', port: 5060, protocol: 'http' },
            { host: '149.129.226.9', port: 41, protocol: 'http' },
            { host: '104.238.160.36', port: 80, protocol: 'http' },
            { host: '135.181.154.225', port: 80, protocol: 'http' },
            { host: '103.152.112.195', port: 80, protocol: 'http' },
            { host: '103.152.112.159', port: 80, protocol: 'http' },
            { host: '47.56.110.204', port: 8990, protocol: 'http' },
            { host: '123.30.154.171', port: 7777, protocol: 'http' },
            { host: '103.152.112.186', port: 80, protocol: 'http' },
            { host: '5.106.6.235', port: 80, protocol: 'http' },
            { host: '47.56.110.204', port: 8989, protocol: 'http' },
            { host: '81.169.213.169', port: 8888, protocol: 'http' },
            { host: '143.42.66.91', port: 80, protocol: 'http' },
            { host: '47.237.113.119', port: 5060, protocol: 'http' },
            { host: '45.92.177.60', port: 8080, protocol: 'http' },
            { host: '97.74.87.226', port: 80, protocol: 'http' },
            { host: '154.85.58.149', port: 80, protocol: 'http' },
            { host: '47.252.18.37', port: 9080, protocol: 'http' },
            { host: '41.59.227.49', port: 3128, protocol: 'http' },
            { host: '50.250.56.129', port: 9898, protocol: 'socks4' },
            { host: '103.118.40.119', port: 80, protocol: 'http' },
            { host: '8.211.194.85', port: 18080, protocol: 'http' },
            { host: '52.65.193.254', port: 3128, protocol: 'http' },
            { host: '13.246.209.48', port: 1080, protocol: 'http' },
            { host: '43.157.47.47', port: 443, protocol: 'http' },
            { host: '219.65.73.81', port: 80, protocol: 'http' },
            { host: '3.71.239.218', port: 3128, protocol: 'http' },
            { host: '149.129.226.9', port: 3128, protocol: 'http' },
            { host: '38.54.116.9', port: 80, protocol: 'http' },
            { host: '204.236.137.68', port: 80, protocol: 'http' },
            { host: '54.248.238.110', port: 80, protocol: 'http' },
            { host: '3.123.150.192', port: 80, protocol: 'http' },
            { host: '47.238.130.212', port: 8008, protocol: 'http' },
            { host: '13.37.89.201', port: 80, protocol: 'http' },
            { host: '3.127.121.101', port: 80, protocol: 'http' },
            { host: '3.78.92.159', port: 3128, protocol: 'http' },
            { host: '47.91.29.151', port: 4145, protocol: 'http' },
            { host: '3.124.133.93', port: 3128, protocol: 'http' },
            { host: '52.196.1.182', port: 80, protocol: 'http' },
            { host: '44.219.175.186', port: 80, protocol: 'http' },
            { host: '63.32.1.88', port: 3128, protocol: 'http' },
            { host: '8.215.15.163', port: 104, protocol: 'http' },
            { host: '35.79.120.242', port: 3128, protocol: 'http' },
            { host: '52.67.10.183', port: 80, protocol: 'http' },
            { host: '8.221.138.111', port: 8443, protocol: 'http' },
            { host: '144.126.216.57', port: 80, protocol: 'http' },
            { host: '3.97.176.251', port: 3128, protocol: 'http' },
            { host: '13.36.104.85', port: 80, protocol: 'http' },
            { host: '54.152.3.36', port: 80, protocol: 'http' },
            { host: '3.126.147.182', port: 80, protocol: 'http' },
            { host: '3.90.100.12', port: 80, protocol: 'http' },
            { host: '34.64.4.65', port: 80, protocol: 'http' },
            { host: '8.213.197.208', port: 3128, protocol: 'http' },
            { host: '3.21.101.158', port: 3128, protocol: 'http' },
            { host: '18.223.25.15', port: 80, protocol: 'http' },
            { host: '13.213.114.238', port: 3128, protocol: 'http' },
            { host: '47.91.109.17', port: 8008, protocol: 'http' },
            { host: '15.156.24.206', port: 3128, protocol: 'http' },
            { host: '8.210.17.35', port: 8082, protocol: 'http' },
            { host: '204.10.70.33', port: 80, protocol: 'http' },
            { host: '8.213.129.20', port: 1099, protocol: 'http' },
            { host: '13.37.73.214', port: 80, protocol: 'http' },
            { host: '52.63.129.110', port: 3128, protocol: 'http' },
            { host: '47.74.46.81', port: 1000, protocol: 'http' },
            { host: '65.108.195.47', port: 8080, protocol: 'http' },
            { host: '8.211.42.167', port: 80, protocol: 'http' },
            { host: '54.67.125.45', port: 3128, protocol: 'http' },
            { host: '8.212.151.166', port: 8081, protocol: 'http' },
            { host: '44.195.247.145', port: 80, protocol: 'http' },
            { host: '18.228.149.161', port: 80, protocol: 'http' },
            { host: '13.37.59.99', port: 3128, protocol: 'http' },
            { host: '13.55.210.141', port: 3128, protocol: 'http' },
            { host: '8.213.134.213', port: 20002, protocol: 'http' },
            { host: '43.201.121.81', port: 80, protocol: 'http' },
            { host: '8.213.222.247', port: 1080, protocol: 'http' },
            { host: '3.139.242.184', port: 80, protocol: 'http' },
            { host: '44.218.183.55', port: 80, protocol: 'http' },
            { host: '47.90.149.238', port: 11, protocol: 'http' },
            { host: '3.124.133.93', port: 80, protocol: 'http' },
            { host: '47.254.36.213', port: 9098, protocol: 'http' },
            { host: '43.202.154.212', port: 80, protocol: 'http' },
            { host: '13.37.89.201', port: 3128, protocol: 'http' },
            { host: '203.95.196.199', port: 8080, protocol: 'http' },
            { host: '38.242.202.236', port: 8080, protocol: 'http' },
            { host: '51.16.179.113', port: 1080, protocol: 'http' },
            { host: '8.215.12.103', port: 8085, protocol: 'http' },
            { host: '139.162.78.109', port: 3128, protocol: 'http' },
            { host: '113.212.108.107', port: 8080, protocol: 'http' },
            { host: '8.211.194.85', port: 5060, protocol: 'http' },
            { host: '43.200.77.128', port: 3128, protocol: 'http' },
            { host: '18.117.129.49', port: 3128, protocol: 'http' },
            { host: '47.89.159.212', port: 8123, protocol: 'http' },
            { host: '8.221.138.111', port: 18080, protocol: 'http' },
            { host: '51.20.19.159', port: 3128, protocol: 'http' },
            { host: '41.59.90.171', port: 80, protocol: 'http' },
            { host: '54.94.26.82', port: 3128, protocol: 'http' },
            { host: '3.129.184.210', port: 80, protocol: 'http' },
            { host: '8.213.195.191', port: 90, protocol: 'http' },
            { host: '51.20.50.149', port: 3128, protocol: 'http' },
            { host: '37.187.25.85', port: 80, protocol: 'http' },
            { host: '69.63.69.90', port: 8080, protocol: 'http' },
            { host: '8.213.195.191', port: 9191, protocol: 'http' },
            { host: '80.249.112.163', port: 80, protocol: 'http' },
            { host: '51.17.58.162', port: 3128, protocol: 'http' },
            { host: '103.152.112.157', port: 80, protocol: 'http' },
            { host: '13.36.113.81', port: 3128, protocol: 'http' },
            { host: '8.210.17.35', port: 4321, protocol: 'http' },
            { host: '3.97.167.115', port: 3128, protocol: 'http' },
            { host: '8.213.222.247', port: 8080, protocol: 'http' },
            { host: '3.139.242.184', port: 3128, protocol: 'http' },
            { host: '85.215.64.49', port: 80, protocol: 'http' },
            { host: '54.233.119.172', port: 3128, protocol: 'http' },
            { host: '167.172.181.111', port: 80, protocol: 'http' },
            { host: '8.213.222.247', port: 18080, protocol: 'http' },
            { host: '83.168.74.163', port: 8080, protocol: 'http' },
            { host: '8.213.134.213', port: 3333, protocol: 'http' },
            { host: '8.215.12.103', port: 8002, protocol: 'http' },
            { host: '13.246.184.110', port: 3128, protocol: 'http' },
            { host: '13.38.176.104', port: 3128, protocol: 'http' },
            { host: '149.129.255.179', port: 4002, protocol: 'http' },
            { host: '23.247.136.254', port: 80, protocol: 'http' },
            { host: '91.241.217.58', port: 9090, protocol: 'http' },
            { host: '3.71.239.218', port: 80, protocol: 'http' },
            { host: '162.223.90.130', port: 80, protocol: 'http' },
            { host: '184.169.154.119', port: 80, protocol: 'http' },
            { host: '47.91.109.17', port: 8081, protocol: 'http' },
            { host: '43.163.87.93', port: 8443, protocol: 'http' },
            { host: '47.237.2.245', port: 4145, protocol: 'http' },
            { host: '212.127.95.235', port: 8081, protocol: 'http' },
            { host: '138.197.112.162', port: 80, protocol: 'http' },
            { host: '35.72.118.126', port: 80, protocol: 'http' },
            { host: '52.73.224.54', port: 3128, protocol: 'http' },
            { host: '3.78.92.159', port: 80, protocol: 'http' },
            { host: '13.48.109.48', port: 3128, protocol: 'http' },
            { host: '43.156.59.228', port: 80, protocol: 'http' },
            { host: '54.228.164.102', port: 3128, protocol: 'http' },
            { host: '8.210.17.35', port: 8003, protocol: 'http' },
            { host: '8.213.134.213', port: 1111, protocol: 'http' },
            { host: '47.252.11.233', port: 8443, protocol: 'http' },
            { host: '156.244.0.116', port: 55553, protocol: 'http' },
            { host: '47.238.134.126', port: 9098, protocol: 'http' },
            { host: '85.214.155.58', port: 8080, protocol: 'http' },
            { host: '13.36.87.105', port: 3128, protocol: 'http' },
            { host: '3.12.144.146', port: 3128, protocol: 'http' },
            { host: '13.59.156.167', port: 3128, protocol: 'http' },
            { host: '158.255.77.169', port: 80, protocol: 'http' },
            { host: '165.232.129.150', port: 80, protocol: 'http' },
            { host: '46.51.249.135', port: 3128, protocol: 'http' },
            { host: '3.37.125.76', port: 3128, protocol: 'http' },
            { host: '185.212.60.63', port: 80, protocol: 'http' },
            { host: '52.16.232.164', port: 3128, protocol: 'http' },
            { host: '3.130.65.162', port: 3128, protocol: 'http' },
            { host: '176.9.239.181', port: 80, protocol: 'http' },
            { host: '54.179.39.14', port: 3128, protocol: 'http' },
            { host: '13.56.192.187', port: 80, protocol: 'http' },
            { host: '13.38.153.36', port: 80, protocol: 'http' },
            { host: '219.79.89.247', port: 8080, protocol: 'http' },
            { host: '45.61.159.42', port: 3128, protocol: 'http' },
            { host: '18.185.169.150', port: 3128, protocol: 'http' },
            { host: '3.136.29.104', port: 80, protocol: 'http' },
            { host: '204.236.176.61', port: 3128, protocol: 'http' },
            { host: '3.129.184.210', port: 3128, protocol: 'http' },
            { host: '149.129.226.9', port: 8080, protocol: 'http' },
            { host: '13.208.56.180', port: 80, protocol: 'http' },
            { host: '15.236.106.236', port: 3128, protocol: 'http' },
            { host: '190.210.186.241', port: 80, protocol: 'http' },
            { host: '149.129.255.179', port: 8443, protocol: 'http' },
            { host: '87.248.129.26', port: 80, protocol: 'http' },
            { host: '149.129.226.9', port: 9080, protocol: 'http' },
            { host: '99.80.11.54', port: 3128, protocol: 'http' },
            { host: '35.76.62.196', port: 80, protocol: 'http' },
            { host: '3.122.84.99', port: 3128, protocol: 'http' },
            { host: '47.76.144.139', port: 9080, protocol: 'http' },
            { host: '63.35.64.177', port: 3128, protocol: 'http' },
            { host: '16.16.239.39', port: 3128, protocol: 'http' },
            { host: '37.204.144.240', port: 8080, protocol: 'http' },
            { host: '3.141.217.225', port: 80, protocol: 'http' },
            { host: '54.179.44.51', port: 3128, protocol: 'http' },
            { host: '3.126.147.182', port: 3128, protocol: 'http' },
            { host: '3.212.148.199', port: 3128, protocol: 'http' },
            { host: '8.220.204.215', port: 9080, protocol: 'http' },
            { host: '47.238.130.212', port: 8002, protocol: 'http' }
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