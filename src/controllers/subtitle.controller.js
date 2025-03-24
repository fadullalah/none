import { fetchAndConvertSubtitles, searchSubtitles, downloadSubtitle } from '../utils/subtitle-converter.js';

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
  },
  
  async searchSubtitles(req, res) {
    try {
      const {
        query,
        imdb_id,
        tmdb_id,
        season_number,
        episode_number,
        languages = 'en',
        type,
        year,
      } = req.query;
      
      if (!query && !imdb_id && !tmdb_id) {
        return res.status(400).json({ 
          error: 'At least one search parameter is required (query, imdb_id, or tmdb_id)' 
        });
      }
      
      const searchParams = {
        query,
        imdb_id: imdb_id ? parseInt(imdb_id, 10) : undefined,
        tmdb_id: tmdb_id ? parseInt(tmdb_id, 10) : undefined,
        season_number: season_number ? parseInt(season_number, 10) : undefined,
        episode_number: episode_number ? parseInt(episode_number, 10) : undefined,
        languages,
        type,
        year: year ? parseInt(year, 10) : undefined
      };
      
      console.log('Searching subtitles with params:', searchParams);
      const searchResults = await searchSubtitles(searchParams);
      
      return res.json({
        success: true,
        total: searchResults.total_count,
        page: searchResults.page,
        data: searchResults.data
      });
    } catch (error) {
      console.error('Subtitle search failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to search for subtitles',
        details: error.message
      });
    }
  },
  
  async downloadSubtitle(req, res) {
    try {
      const { file_id, vtt = true } = req.query;
      
      if (!file_id) {
        return res.status(400).json({ error: 'file_id is required' });
      }
      
      console.log(`Downloading subtitle with file_id: ${file_id}`);
      const subtitleData = await downloadSubtitle(parseInt(file_id, 10));
      
      // Return content as VTT
      if (vtt === 'true' || vtt === '1') {
        res.set({
          'Content-Type': 'text/vtt',
          'Content-Disposition': `inline; filename="${subtitleData.fileName.replace(/\.\w+$/, '.vtt')}"`,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*'
        });
        
        return res.send(subtitleData.content);
      }
      
      // Return metadata only
      return res.json({
        success: true,
        subtitle: subtitleData
      });
    } catch (error) {
      console.error('Subtitle download failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to download subtitle',
        details: error.message
      });
    }
  }
};