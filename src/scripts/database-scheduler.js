import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseScheduler {
  constructor() {
    this.dbPath = path.join(process.cwd(), 'imdb_movies.db');
    this.isRunning = false;
    this.setupCronJob();
  }

  setupCronJob() {
    // Run every 2 days at 2 AM UTC (adjust timezone as needed)
    // Format: second minute hour day month dayOfWeek
    const cronExpression = '0 0 2 */2 * *'; // Every 2 days at 2 AM
    
    console.log('🕐 Setting up database regeneration cron job...');
    console.log(`📅 Schedule: Every 2 days at 2 AM UTC (${cronExpression})`);
    
    cron.schedule(cronExpression, async () => {
      await this.regenerateDatabase();
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    // Also run immediately on startup if database doesn't exist
    this.checkAndRegenerateIfNeeded();
  }

  async checkAndRegenerateIfNeeded() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        console.log('📊 IMDB database not found. Starting initial generation...');
        await this.regenerateDatabase();
      } else {
        console.log('✅ IMDB database exists. Next regeneration scheduled.');
      }
    } catch (error) {
      console.error('❌ Error checking database status:', error);
    }
  }

  async regenerateDatabase() {
    if (this.isRunning) {
      console.log('⏳ Database regeneration already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = new Date();
    
    try {
      console.log('🔄 Starting database regeneration...');
      console.log(`⏰ Started at: ${startTime.toISOString()}`);

      // Clean up old database
      await this.cleanupOldDatabase();

      // Run the IMDB to SQLite conversion
      await this.runDatabaseSetup();

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);
      
      console.log('✅ Database regeneration completed successfully!');
      console.log(`⏱️  Duration: ${duration} seconds`);
      console.log(`📊 Database size: ${this.getDatabaseSize()} MB`);
      console.log(`🕐 Next regeneration: ${this.getNextRunTime()}`);

    } catch (error) {
      console.error('❌ Database regeneration failed:', error);
      console.error('📝 Error details:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  async cleanupOldDatabase() {
    try {
      if (fs.existsSync(this.dbPath)) {
        console.log('🗑️  Removing old database...');
        fs.unlinkSync(this.dbPath);
        console.log('✅ Old database removed');
      }
    } catch (error) {
      console.error('⚠️  Warning: Could not remove old database:', error.message);
    }
  }

  async runDatabaseSetup() {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'imdb-to-sqlite.js');
      
      console.log('📥 Running IMDB to SQLite conversion...');
      
      const child = spawn('node', [scriptPath], {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Database setup completed successfully');
          resolve();
        } else {
          reject(new Error(`Database setup failed with exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start database setup: ${err.message}`));
      });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Database setup timed out after 30 minutes'));
      }, 30 * 60 * 1000); // 30 minutes timeout

      child.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  getDatabaseSize() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const stats = fs.statSync(this.dbPath);
        return (stats.size / (1024 * 1024)).toFixed(2);
      }
      return '0';
    } catch (error) {
      return 'Unknown';
    }
  }

  getNextRunTime() {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + 2);
    nextRun.setHours(2, 0, 0, 0);
    return nextRun.toISOString();
  }

  // Method to manually trigger regeneration (useful for testing)
  async triggerRegeneration() {
    console.log('🔧 Manual database regeneration triggered');
    await this.regenerateDatabase();
  }

  // Method to get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      databaseExists: fs.existsSync(this.dbPath),
      databaseSize: this.getDatabaseSize(),
      nextRunTime: this.getNextRunTime()
    };
  }
}

export default DatabaseScheduler;
