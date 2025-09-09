import express from 'express';
import MovieController from '../controllers/movie.controller.js';

const router = express.Router();
const movieController = new MovieController();

// Search movies by title
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const movies = await movieController.searchMovies(q, parseInt(limit), parseInt(offset));
    
    res.json({
      success: true,
      data: movies,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: movies.length
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get movie by ID
router.get('/:tconst', async (req, res) => {
  try {
    const { tconst } = req.params;
    
    const movie = await movieController.getMovieById(tconst);
    
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    res.json({
      success: true,
      data: movie
    });
  } catch (error) {
    console.error('Get movie error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get movies by year
router.get('/year/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    const movies = await movieController.getMoviesByYear(
      parseInt(year), 
      parseInt(limit), 
      parseInt(offset)
    );
    
    res.json({
      success: true,
      data: movies,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: movies.length
      }
    });
  } catch (error) {
    console.error('Get movies by year error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get movies by genre
router.get('/genre/:genre', async (req, res) => {
  try {
    const { genre } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    const movies = await movieController.getMoviesByGenre(
      genre, 
      parseInt(limit), 
      parseInt(offset)
    );
    
    res.json({
      success: true,
      data: movies,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: movies.length
      }
    });
  } catch (error) {
    console.error('Get movies by genre error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get random movies
router.get('/random/:limit?', async (req, res) => {
  try {
    const { limit = 10 } = req.params;
    
    const movies = await movieController.getRandomMovies(parseInt(limit));
    
    res.json({
      success: true,
      data: movies,
      count: movies.length
    });
  } catch (error) {
    console.error('Get random movies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get movie database statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await movieController.getMovieStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
