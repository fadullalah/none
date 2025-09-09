# Database Scheduler for IMDB Movies

This system automatically regenerates the IMDB movies database every 2 days to ensure you always have the latest movie data.

## Features

- **Automated Regeneration**: Database is automatically regenerated every 2 days at 2 AM UTC
- **Railway Compatible**: Designed to work seamlessly with Railway hosting
- **Error Handling**: Robust error handling and logging
- **Manual Triggers**: API endpoints to manually trigger regeneration
- **Status Monitoring**: Real-time status monitoring of the scheduler
- **Cleanup**: Automatically removes old database before creating new one

## API Endpoints

### Get Scheduler Status
```
GET /api/scheduler/status
```

Returns:
```json
{
  "success": true,
  "data": {
    "isRunning": false,
    "databaseExists": true,
    "databaseSize": "25.4",
    "nextRunTime": "2024-01-15T02:00:00.000Z",
    "message": "Scheduler is running normally"
  }
}
```

### Manually Trigger Regeneration
```
POST /api/scheduler/regenerate
```

Returns:
```json
{
  "success": true,
  "message": "Database regeneration triggered successfully",
  "data": {
    "status": "Started",
    "message": "Regeneration is running in the background"
  }
}
```

### Get Next Run Time
```
GET /api/scheduler/next-run
```

Returns:
```json
{
  "success": true,
  "data": {
    "nextRunTime": "2024-01-15T02:00:00.000Z",
    "isRunning": false,
    "databaseExists": true,
    "databaseSize": "25.4"
  }
}
```

## Configuration

### Schedule
- **Frequency**: Every 2 days
- **Time**: 2:00 AM UTC
- **Cron Expression**: `0 0 2 */2 * *`

### Timeout
- **Maximum Duration**: 30 minutes per regeneration
- **Auto-cleanup**: Old database is removed before creating new one

## Railway Deployment

The system is fully compatible with Railway:

1. **Automatic Startup**: Scheduler starts automatically when the app starts
2. **Health Checks**: Uses `/health` endpoint for Railway health checks
3. **Error Recovery**: Automatic restart on failure (up to 10 retries)
4. **Resource Management**: Efficient memory usage with SQLite

## Monitoring

### Logs
The scheduler provides detailed logging:
- ✅ Success messages
- ⚠️ Warnings
- ❌ Error messages
- 📊 Progress updates
- ⏰ Timing information

### Status Indicators
- `isRunning`: Whether regeneration is currently in progress
- `databaseExists`: Whether the database file exists
- `databaseSize`: Current database size in MB
- `nextRunTime`: When the next automatic regeneration will occur

## Error Handling

The system handles various error scenarios:

1. **Network Issues**: Retries and graceful failure
2. **Disk Space**: Checks and reports disk usage
3. **Timeout**: 30-minute timeout prevents hanging
4. **Concurrent Runs**: Prevents multiple simultaneous regenerations
5. **Database Corruption**: Automatic cleanup and regeneration

## Manual Operations

### Force Regeneration
If you need to regenerate the database immediately:

```bash
curl -X POST https://your-api.railway.app/api/scheduler/regenerate
```

### Check Status
Monitor the scheduler status:

```bash
curl https://your-api.railway.app/api/scheduler/status
```

## Dependencies

- `node-cron`: For scheduling
- `sqlite3`: For database operations
- `fs`: For file system operations
- `child_process`: For running the setup script

## Notes

- The scheduler runs in the background and doesn't block the main application
- Database regeneration typically takes 5-15 minutes depending on network speed
- The system automatically creates the database on first startup if it doesn't exist
- All operations are logged for debugging and monitoring

