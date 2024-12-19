import express from 'express';
import { videoController } from '../controllers/video.controller.js';
import { subtitleController } from '../controllers/subtitle.controller.js';

const router = express.Router();

router.get('/video-url', videoController.getVideoUrlFromEmbed);
router.get('/tv/:id/:season/:episode', videoController.getTVEpisode);
router.get('/movie/:id', videoController.getMovie);
router.get('/subtitles', subtitleController.convertSubtitles);

export default router;