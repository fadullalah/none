import dotenv from 'dotenv';
dotenv.config();

export const imageController = {
  async downloadImage(req, res) {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Missing image URL' });
    }

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${process.env.API_TOKEN}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Set response headers
      res.set({
        'Content-Disposition': `attachment; filename="${filename || 'image.jpg'}"`,
        'Content-Type': response.headers.get('content-type'),
        'Access-Control-Allow-Origin': '*' // Adjust this for production
      });

      // Pipe the response directly to the client
      response.body.pipe(res);
    } catch (error) {
      console.error('Error downloading image:', error);
      res.status(500).json({ error: 'Error fetching image', message: error.message });
    }
  }
};