import express from 'express';
import { videoController } from '../controllers/video.controller.js';
import { subtitleController } from '../controllers/subtitle.controller.js';
import { imageController } from '../controllers/image.controller.js';
import { imageLoaderController } from '../controllers/imageLoader.controller.js';
import { tmdbController } from '../controllers/tmdb.controller.js';
import { qualityController } from '../controllers/quality.controller.js';

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

// New quality route
router.get('/quality', qualityController.getQualityInfo);

export default router;