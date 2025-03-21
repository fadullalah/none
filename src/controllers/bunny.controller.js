import axios from 'axios';
import NodeCache from 'node-cache';

// Cache with 24 hour TTL to avoid re-uploading same videos
const bunnyCache = new NodeCache({ stdTTL: 86400 });
// Cache for storing the list of all videos in Bunny CDN
const videoListCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

class BunnyStreamController {
  constructor() {
    this.apiUrl = 'https://video.bunnycdn.com/library';
    this.libraryId = process.env.BUNNY_LIBRARY_ID || '399368';
    this.accessKey = process.env.BUNNY_ACCESS_KEY || '97868177-5cd5-4bc6-b1c458818ede-d4e6-4abc';
    this.allVideos = [];
    this.initialized = false;
  }

  /**
   * Initialize the controller by fetching all videos
   */
  async initialize() {
    if (!this.initialized) {
      await this.getAllVideos();
      this.initialized = true;
    }
  }

  /**
   * Fetch all videos from Bunny CDN and cache them
   * @returns {Promise<Array>} List of all videos
   */
  async getAllVideos() {
    const cacheKey = 'bunny_all_videos';
    const cachedVideos = videoListCache.get(cacheKey);
    
    if (cachedVideos) {
      this.allVideos = cachedVideos;
      return cachedVideos;
    }

    try {
      // First request to get total items and pages
      const initialResponse = await axios.get(
        `${this.apiUrl}/${this.libraryId}/videos?page=1`,
        {
          headers: {
            'AccessKey': this.accessKey,
            'accept': 'application/json'
          }
        }
      );
      
      const { totalItems, itemsPerPage, items } = initialResponse.data;
      let allItems = [...items];
      
      // Calculate total pages
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      
      // Fetch remaining pages if needed
      const pagePromises = [];
      for (let page = 2; page <= totalPages; page++) {
        pagePromises.push(
          axios.get(
            `${this.apiUrl}/${this.libraryId}/videos?page=${page}`,
            {
              headers: {
                'AccessKey': this.accessKey,
                'accept': 'application/json'
              }
            }
          )
        );
      }
      
      // Process all remaining pages
      if (pagePromises.length > 0) {
        const pageResponses = await Promise.all(pagePromises);
        for (const response of pageResponses) {
          allItems = [...allItems, ...response.data.items];
        }
      }
      
      // Cache the results
      videoListCache.set(cacheKey, allItems);
      this.allVideos = allItems;
      return allItems;
    } catch (error) {
      console.error(`Error fetching videos from Bunny Stream: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a video with the same title already exists in Bunny CDN
   * @param {string} title - The title to check
   * @returns {boolean} - True if video exists, false otherwise
   */
  async videoExists(title) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return this.allVideos.some(video => 
      video.title.toLowerCase() === title.toLowerCase()
    );
  }

  /**
   * Upload a video to Bunny Stream by providing a URL
   * @param {string} videoUrl - The URL of the video to upload
   * @param {string} title - Optional title for the video
   * @returns {Promise<Object>} - Response from Bunny Stream API
   */
  async uploadVideoByUrl(videoUrl, title = '') {
    try {
      // Skip if URL is vip_only.mp4
      if (videoUrl.includes('vip_only.mp4')) {
        console.log(`Skipping upload of restricted content: ${videoUrl}`);
        return { 
          success: false, 
          error: 'Restricted content (vip_only.mp4) not uploaded',
          isRestricted: true
        };
      }

      // Check if we've already uploaded this video
      const cacheKey = `bunny_upload_${videoUrl}`;
      const cachedResponse = bunnyCache.get(cacheKey);
      
      if (cachedResponse) {
        console.log(`Using cached response for ${videoUrl}`);
        return cachedResponse;
      }

      // Check if video already exists by title
      if (title && await this.videoExists(title)) {
        console.log(`Video with title "${title}" already exists in Bunny CDN`);
        return {
          success: false,
          error: 'Video already exists in library',
          exists: true,
          title
        };
      }

      // Proceed with upload if not found
      const response = await axios.post(
        `${this.apiUrl}/${this.libraryId}/videos`,
        {
          url: videoUrl,
          title: title || `Video_${Date.now()}`
        },
        {
          headers: {
            'AccessKey': this.accessKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Cache the response
      bunnyCache.set(cacheKey, response.data);
      
      // Refresh our video list after upload
      videoListCache.del('bunny_all_videos');
      this.initialized = false;
      
      return response.data;
    } catch (error) {
      console.error(`Error uploading video to Bunny Stream: ${error.message}`);
      return { success: false, error: error.message, videoUrl };
    }
  }

  /**
   * Get video status from Bunny Stream
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

  /**
   * Refresh the video list cache
   */
  async refreshVideoList() {
    videoListCache.del('bunny_all_videos');
    this.initialized = false;
    await this.initialize();
    return this.allVideos;
  }
}

export const bunnyStreamController = new BunnyStreamController(); 