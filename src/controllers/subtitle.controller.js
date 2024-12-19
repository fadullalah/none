import { fetchAndConvertSubtitles } from '../utils/subtitle-converter.js';

export const subtitleController = {
  async convertSubtitles(req, res) {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'Subtitle URL is required' });
    }

    // Log incoming request details
    console.log('Processing subtitle request:', {
      url,
      headers: req.headers,
      ip: req.ip
    });
    
    try {
      const vttContent = await fetchAndConvertSubtitles(url);
      
      // Set appropriate headers for VTT content
      res.set({
        'Content-Type': 'text/vtt',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      
      res.send(vttContent);
    } catch (error) {
      console.error('Subtitle conversion failed:', {
        error: error.message,
        stack: error.stack,
        url: url
      });
      
      res.status(500).json({
        error: 'Failed to convert subtitles',
        details: error.message,
        url: url
      });
    }
  }
};