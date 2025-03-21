import axios from 'axios';
import NodeCache from 'node-cache';

// Cache with 24 hour TTL to avoid re-uploading same videos
const bunnyCache = new NodeCache({ stdTTL: 86400 });

class BunnyStreamController {
  constructor() {
    this.apiUrl = 'https://video.bunnycdn.com/library';
    this.libraryId = process.env.BUNNY_LIBRARY_ID || '399368'; // Use the library ID from your example
    this.accessKey = process.env.BUNNY_ACCESS_KEY || '97868177-5cd5-4bc6-b1c458818ede-d4e6-4abc'; // Use your access key
  }

  /**
   * Upload a video to Bunny Stream by providing a URL
   * @param {string} videoUrl - The URL of the video to upload
   * @param {string} title - Optional title for the video
   * @returns {Promise<Object>} - Response from Bunny Stream API
   */
  async uploadVideoByUrl(videoUrl, title = '') {
    try {
      // Check if we've already uploaded this video
      const cacheKey = `bunny_upload_${videoUrl}`;
      const cachedResponse = bunnyCache.get(cacheKey);
      
      if (cachedResponse) {
        console.log(`🐰 Already uploaded: ${title}`);
        return cachedResponse;
      }

      console.log(`🐰 Uploading: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`);
      
      const response = await axios.post(
        `${this.apiUrl}/${this.libraryId}/videos/fetch`,
        {
          url: videoUrl,
          title: title || `Video ${new Date().toISOString()}`
        },
        {
          headers: {
            'AccessKey': this.accessKey,
            'accept': 'application/json',
            'content-type': 'application/json'
          }
        }
      );

      // Cache the response to avoid re-uploading
      bunnyCache.set(cacheKey, response.data);
      
      console.log(`🐰 Upload success: ${title.substring(0, 30)}... (ID: ${response.data?.id || 'unknown'})`);
      return response.data;
    } catch (error) {
      console.error(`🐰 Upload failed: ${title} - ${error.message}`);
      // Don't throw the error so the original flow can continue
      return {
        success: false,
        error: error.message,
        videoUrl
      };
    }
  }

  /**
   * Get video status/details from Bunny Stream
   * @param {string} videoId - The Bunny Stream video ID
   * @returns {Promise<Object>} - Video details
   */
  async getVideoStatus(videoId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${this.libraryId}/videos/${videoId}`,
        {
          headers: {
            'AccessKey': this.accessKey,
            'accept': 'application/json'
          }
        }
      );
      
      return response.data;
    } catch (error) {
      console.error(`Error getting video status from Bunny Stream: ${error.message}`);
      return { success: false, error: error.message, videoId };
    }
  }
}

export const bunnyStreamController = new BunnyStreamController(); 