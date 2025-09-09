import express from 'express';
import { schedulerController } from '../controllers/scheduler.controller.js';

const router = express.Router();

// Get scheduler status
router.get('/status', schedulerController.getStatus);

// Manually trigger database regeneration
router.post('/regenerate', schedulerController.triggerRegeneration);

// Get next scheduled run time
router.get('/next-run', schedulerController.getNextRun);

export default router;
