import fetch from 'node-fetch';

export const imageLoaderController = {
  async preloadImages(req, res) {
    const imagePaths = req.query.path;
    
    if (!imagePaths || !imagePaths.length) {
      return res.status(400).json({ error: 'At least one image path is required' });
    }

    // Convert to array if single path
    const pathsArray = Array.isArray(imagePaths) ? imagePaths : [imagePaths];

    try {
      const images = await Promise.all(pathsArray.map(fetchAndEncodeImage));

      res.set({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=86400'
      });

      res.json({ images });
    } catch (error) {
      console.error('Error processing images:', error);
      res.status(500).json({ error: 'Failed to process images' });
    }
  }
};

async function fetchAndEncodeImage(path) {
  const imageUrl = `https://image.tmdb.org/t/p/original${path}`;
  
  try {
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    
    return { 
      path, 
      dataUrl: `data:${imageResponse.headers.get('content-type') || 'image/jpeg'};base64,${base64}` 
    };
  } catch (error) {
    console.error('Error fetching image:', error, path);
    return { path, error: 'Failed to fetch image' };
  }
}