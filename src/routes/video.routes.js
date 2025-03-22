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
import { bunnyStreamController } from '../controllers/bunny.controller.js';

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
router.get('/showbox/:type/:tmdbId', showboxController.getShowboxUrl);

// New showbox-related routes
router.get('/bunny/videos', showboxController.listBunnyVideos);
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

// New Bunny Stream routes
router.get('/bunny/collections', async (req, res) => {
  try {
    await bunnyStreamController.initialize();
    
    return res.json({
      success: true,
      total: bunnyStreamController.allCollections.length,
      collections: bunnyStreamController.allCollections.map(c => ({
        id: c.guid,
        name: c.name,
        videoCount: c.videoCount
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/bunny/collections/:id/videos', async (req, res) => {
  try {
    const { id } = req.params;
    const videos = await bunnyStreamController.getCollectionVideos(id);
    
    return res.json({
      success: true,
      total: videos.length,
      videos: videos.map(v => ({
        id: v.guid,
        title: v.title,
        status: v.status,
        created: v.dateUploaded,
        length: v.length,
        url: v.directPlayUrl
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;