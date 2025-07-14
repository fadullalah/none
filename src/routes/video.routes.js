import express from 'express';
import { videoController } from '../controllers/video.controller.js';
import { subtitleController } from '../controllers/subtitle.controller.js';
import { imageController } from '../controllers/image.controller.js';
import { imageLoaderController } from '../controllers/imageLoader.controller.js';
import { tmdbController } from '../controllers/tmdb.controller.js';
import { qualityController } from '../controllers/quality.controller.js';
import { scraperController } from '../controllers/scraper.controller.js';
import { seriesScraperController } from '../controllers/series.scraper.controller.js';
import { parentalRatingController } from '../controllers/parental.rating.controller.js';
import { showboxController } from '../controllers/showbox.controller.js';
import { playerScraperController } from '../controllers/player.scraper.controller.js';
import { faselhdController } from '../controllers/faselhd.controller.js';
import { alootvController } from '../controllers/alooytv.controller.js';

import { subtitleCache } from '../utils/cache-manager.js';
import { movieboxController } from '../controllers/moviebox.controller.js';

const router = express.Router();

// Existing routes
router.get('/video-url', videoController.getVideoUrlFromEmbed);
router.get('/tv/:id/:season/:episode', videoController.getTVEpisode);
router.get('/movie/:id', videoController.getMovie);
router.get('/subtitles', subtitleController.convertSubtitles);
router.get('/image', imageController.downloadImage);
router.get('/preload-images', imageLoaderController.preloadImages);
router.get('/trending-posters', tmdbController.getTrendingPosters);
router.get('/random-backdrops', tmdbController.getRandomBackdrops);
router.get('/scrape/movie/:tmdb_id', scraperController.scrapeMovieLinks);
router.get('/scrape/series/:tmdb_id', seriesScraperController.scrapeSeriesLinks);
router.get('/parental-rating/:type/:title', parentalRatingController.getParentalRating);
// ShowBox scraper route - supports ?new parameter to bypass cache
router.get('/showbox/:type/:tmdbId', showboxController.getShowboxUrl);

// New showbox-related routes
router.get('/showbox/clear-cache', showboxController.clearCache);

// New quality route
router.get('/quality', qualityController.getQualityInfo);

// Player scraper route
router.get('/extract-video', (req, res) => playerScraperController.extractVideoUrl(req, res));

// FaselHD routes
router.get('/faselhd/movie/:tmdbId', faselhdController.getMovieByTmdbId.bind(faselhdController));
router.get('/faselhd/tv/:tmdbId', faselhdController.getTvEpisodeByTmdbId.bind(faselhdController));

// AlooTV routes
router.get('/alootv/movie/:tmdbId', alootvController.getMovieByTmdbId.bind(alootvController));
router.get('/alootv/tv/:tmdbId', alootvController.getTvEpisodeByTmdbId.bind(alootvController));



// New OpenSubtitles API routes
router.get('/subtitles/search', subtitleController.searchSubtitles);
router.get('/subtitles/download', subtitleController.downloadSubtitle);

// Cache management route
router.post('/subtitles/clear-cache', async (req, res) => {
  try {
    const { type = 'all' } = req.query;
    
    let result = false;
    
    if (type === 'search') {
      result = await subtitleCache.clearSearchCache();
    } else if (type === 'content') {
      result = await subtitleCache.clearContentCache();
    } else {
      result = await subtitleCache.clearAllCaches();
    }
    
    return res.json({
      success: result,
      message: `${type} subtitle cache cleared successfully`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to clear subtitle cache',
      details: error.message
    });
  }
});

// MovieBox routes
router.get('/moviebox/movie/:tmdbId', movieboxController.getMovieByTmdbId.bind(movieboxController));
router.get('/moviebox/tv/:tmdbId', movieboxController.getTvEpisodeByTmdbId.bind(movieboxController));

// MovieBox subtitle routes
router.get('/moviebox/movie/:tmdbId/subtitles', movieboxController.getMovieSubtitlesByTmdbId.bind(movieboxController));
router.get('/moviebox/tv/:tmdbId/subtitles', movieboxController.getTvEpisodeSubtitlesByTmdbId.bind(movieboxController));

export default router;