import { fetchAndConvertSubtitles } from '../utils/subtitle-converter.js';

export const subtitleController = {
  async convertSubtitles(req, res) {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'Subtitle URL is required' });
    }
    
    try {
      const vttContent = await fetchAndConvertSubtitles(url);
      
      // Set appropriate headers for VTT content
      res.set({
        'Content-Type': 'text/vtt',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600'
      });
      
      res.send(vttContent);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to convert subtitles',
        details: error.message
      });
    }
  }
};