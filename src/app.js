import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer-extra';
import { browserOptions, createStealthPage } from './utils/browser.js';
import videoRoutes from './routes/video.routes.js';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Allow all CORS
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://nunflix-firebase.firebaseapp.com',
    'https://nunflix-firebase.web.app', 
    'https://nunflix.com',
    'https://new-test-player-nunflix.vercel.app',
    'https://nunflix.org',
    'https://nunflix.vercel.app',
    'http://192.168.100.168:5173',
    'https://nunflix.app',
    'https://nunflix-ey9.pages.dev',
    'https://com.nunflix.app',
    'https://n-player.pages.dev'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: '*'
}));

// Route prefix
app.use('/api', videoRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Launch browser with stealth settings
    const browser = await puppeteer.launch(browserOptions);
    const page = await createStealthPage(browser);
    
    // Test access to vidlink.pro
    const response = await page.goto('https://vidlink.pro', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await browser.close();

    // Check response status
    const isAccessible = response.status() === 200;

    res.json({
      status: isAccessible ? 'OK' : 'BLOCKED',
      timestamp: new Date().toISOString(),
      vidlink: {
        accessible: isAccessible,
        statusCode: response.status(),
        headers: response.headers()
      }
    });

  } catch (error) {
    res.json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      vidlink: {
        accessible: false,
        error: error.message
      }
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});
