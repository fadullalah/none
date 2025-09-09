import sqlite3 from 'sqlite3';
import path from 'path';

class MovieController {
  constructor() {
    this.dbPath = path.join(process.cwd(), 'imdb_movies.db');
    this.db = null;
  }

  async connect() {
    if (!this.db) {
      return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  async searchMovies(query, limit = 50, offset = 0) {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT tconst, title
        FROM movies 
        WHERE title LIKE ?
        ORDER BY title ASC
        LIMIT ? OFFSET ?
      `;
      
      const searchTerm = `%${query}%`;
      
      this.db.all(sql, [searchTerm, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getMovieById(tconst) {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM movies WHERE tconst = ?';
      
      this.db.get(sql, [tconst], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getMoviesByYear(year, limit = 50, offset = 0) {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT tconst, title
        FROM movies 
        WHERE title LIKE ?
        ORDER BY title ASC
        LIMIT ? OFFSET ?
      `;
      
      const yearPattern = `%(${year})%`;
      
      this.db.all(sql, [yearPattern, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getMoviesByGenre(genre, limit = 50, offset = 0) {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      // Since we don't store genres anymore, return random movies
      const sql = `
        SELECT tconst, title
        FROM movies 
        ORDER BY RANDOM()
        LIMIT ? OFFSET ?
      `;
      
      this.db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getRandomMovies(limit = 10) {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT tconst, title
        FROM movies 
        ORDER BY RANDOM()
        LIMIT ?
      `;
      
      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getMovieStats() {
    await this.connect();
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as totalMovies
        FROM movies
      `;
      
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          }
          resolve();
        });
      });
    }
  }
}

export default MovieController;
