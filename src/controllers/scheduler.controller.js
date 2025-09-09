import DatabaseScheduler from '../scripts/database-scheduler.js';

// Initialize the scheduler instance
const scheduler = new DatabaseScheduler();

export const schedulerController = {
  // Get scheduler status
  async getStatus(req, res) {
    try {
      const status = scheduler.getStatus();
      
      res.json({
        success: true,
        data: {
          ...status,
          message: status.isRunning 
            ? 'Database regeneration is currently in progress' 
            : 'Scheduler is running normally'
        }
      });
    } catch (error) {
      console.error('Error getting scheduler status:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get scheduler status' 
      });
    }
  },

  // Manually trigger database regeneration
  async triggerRegeneration(req, res) {
    try {
      // Check if already running
      if (scheduler.isRunning) {
        return res.status(409).json({
          success: false,
          error: 'Database regeneration is already in progress'
        });
      }

      // Trigger regeneration in background
      scheduler.triggerRegeneration().catch(error => {
        console.error('Manual regeneration failed:', error);
      });

      res.json({
        success: true,
        message: 'Database regeneration triggered successfully',
        data: {
          status: 'Started',
          message: 'Regeneration is running in the background'
        }
      });
    } catch (error) {
      console.error('Error triggering regeneration:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to trigger database regeneration' 
      });
    }
  },

  // Get next scheduled run time
  async getNextRun(req, res) {
    try {
      const status = scheduler.getStatus();
      
      res.json({
        success: true,
        data: {
          nextRunTime: status.nextRunTime,
          isRunning: status.isRunning,
          databaseExists: status.databaseExists,
          databaseSize: status.databaseSize
        }
      });
    } catch (error) {
      console.error('Error getting next run time:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get next run time' 
      });
    }
  }
};

