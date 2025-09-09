import fs from 'fs';
import https from 'https';
import zlib from 'zlib';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';

const gunzip = promisify(zlib.gunzip);

class IMDBToSQLite {
  constructor() {
    this.dbPath = path.join(process.cwd(), 'imdb_movies.db');
    this.tsvPath = path.join(process.cwd(), 'title.basics.tsv');
    this.gzPath = path.join(process.cwd(), 'title.basics.tsv.gz');
    this.db = null;
  }

  async downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      console.log(`Downloading ${url}...`);
      const file = fs.createWriteStream(filePath);
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log(`Downloaded: ${filePath}`);
          resolve();
        });
        
        file.on('error', (err) => {
          fs.unlink(filePath, () => {}); // Delete the file on error
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  async extractGzFile(gzPath, outputPath) {
    console.log(`Extracting ${gzPath}...`);
    const compressed = fs.readFileSync(gzPath);
    const decompressed = await gunzip(compressed);
    fs.writeFileSync(outputPath, decompressed);
    console.log(`Extracted: ${outputPath}`);
  }

  async createDatabase() {
    console.log('Creating SQLite database...');
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          resolve();
        }
      });
    });
  }

  async createTable() {
    console.log('Creating movies table...');
    return new Promise((resolve, reject) => {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS movies (
          tconst TEXT PRIMARY KEY,
          title TEXT
        )
      `;
      
      this.db.run(createTableSQL, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Movies table created');
          resolve();
        }
      });
    });
  }

  async createIndexes() {
    console.log('Creating indexes for fast lookups...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_title ON movies(title)'
    ];

    for (const indexSQL of indexes) {
      await new Promise((resolve, reject) => {
        this.db.run(indexSQL, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    console.log('Indexes created');
  }

  async processTSVFile() {
    console.log('Processing TSV file and filtering movies...');
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(this.tsvPath, { encoding: 'utf8' });
      let lineCount = 0;
      let movieCount = 0;
      let batch = [];
      const BATCH_SIZE = 1000;

      const insertBatch = () => {
        if (batch.length === 0) return Promise.resolve();
        
        return new Promise((resolveBatch, rejectBatch) => {
          const placeholders = batch.map(() => '(?, ?)').join(',');
          const values = batch.flat();
          const sql = `INSERT OR REPLACE INTO movies VALUES ${placeholders}`;
          
          this.db.run(sql, values, (err) => {
            if (err) {
              rejectBatch(err);
            } else {
              resolveBatch();
            }
          });
        });
      };

      readStream.on('data', async (chunk) => {
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (lineCount === 0) {
            // Skip header
            lineCount++;
            continue;
          }
          
          if (line.trim()) {
            const columns = line.split('\t');
            
            // Filter for movies only (titleType = 'movie')
            if (columns.length >= 9 && columns[1] === 'movie') {
              const [
                tconst,
                titleType,
                primaryTitle,
                originalTitle,
                isAdult,
                startYear,
                endYear,
                runtimeMinutes,
                genres
              ] = columns;

              // Skip if no valid year
              if (startYear === '\\N') continue;

              // Optimize title storage: if primary and original titles match, store only one
              let title;
              if (primaryTitle === originalTitle) {
                title = primaryTitle; // Store only one title when they match
              } else {
                title = `${primaryTitle} (${originalTitle})`; // Store both when different
              }

              // Add year to title format: "Fast X (2023)"
              const year = parseInt(startYear);
              const titleWithYear = `${title} (${year})`;

              const movie = [
                tconst,
                titleWithYear
              ];

              batch.push(movie);
              movieCount++;

              if (batch.length >= BATCH_SIZE) {
                try {
                  await insertBatch();
                  batch = [];
                  console.log(`Processed ${movieCount} movies...`);
                } catch (err) {
                  reject(err);
                  return;
                }
              }
            }
          }
          lineCount++;
        }
      });

      readStream.on('end', async () => {
        try {
          // Insert remaining batch
          if (batch.length > 0) {
            await insertBatch();
          }
          console.log(`Total movies processed: ${movieCount}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      readStream.on('error', (err) => {
        reject(err);
      });
    });
  }

  async getDatabaseStats() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM movies', (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  async closeDatabase() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
        resolve();
      });
    });
  }

  async cleanup() {
    console.log('Cleaning up temporary files...');
    try {
      if (fs.existsSync(this.tsvPath)) {
        fs.unlinkSync(this.tsvPath);
        console.log('Deleted TSV file');
      }
      if (fs.existsSync(this.gzPath)) {
        fs.unlinkSync(this.gzPath);
        console.log('Deleted GZ file');
      }
    } catch (err) {
      console.error('Error during cleanup:', err);
    }
  }

  async run() {
    try {
      console.log('Starting IMDB to SQLite conversion...');
      
      // Download the file
      await this.downloadFile('https://datasets.imdbws.com/title.basics.tsv.gz', this.gzPath);
      
      // Extract the file
      await this.extractGzFile(this.gzPath, this.tsvPath);
      
      // Create database and table
      await this.createDatabase();
      await this.createTable();
      
      // Process the TSV file
      await this.processTSVFile();
      
      // Create indexes
      await this.createIndexes();
      
      // Get final stats
      const movieCount = await this.getDatabaseStats();
      console.log(`\n✅ Successfully created SQLite database with ${movieCount} movies`);
      console.log(`Database file: ${this.dbPath}`);
      
      // Get file size
      const stats = fs.statSync(this.dbPath);
      const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`Database size: ${fileSizeInMB} MB`);
      
      // Cleanup
      await this.cleanup();
      
      await this.closeDatabase();
      
    } catch (error) {
      console.error('Error:', error);
      await this.cleanup();
      process.exit(1);
    }
  }
}

// Run the script
const converter = new IMDBToSQLite();
converter.run();
