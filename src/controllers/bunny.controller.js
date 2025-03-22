import axios from 'axios';
import NodeCache from 'node-cache';

// Cache with 24 hour TTL to avoid re-uploading same videos
const bunnyCache = new NodeCache({ stdTTL: 86400 });
// Cache for storing the list of all videos in Bunny CDN
const videoListCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
// Cache for collections
const collectionsCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

class BunnyStreamController {
  constructor() {
    this.apiUrl = 'https://video.bunnycdn.com/library';
    this.libraryId = process.env.BUNNY_LIBRARY_ID || '399660';
    this.accessKey = process.env.BUNNY_ACCESS_KEY || '93735415-1258-4961-9b207c07a5ec-3912-45e5';
    this.allVideos = [];
    this.allCollections = [];
    this.initialized = false;
    this.collectionsInitialized = false;
  }

  /**
   * Initialize the controller by fetching all videos and collections
   */
  async initialize() {
    if (!this.initialized) {
      await this.getAllVideos();
      await this.getAllCollections();
      this.initialized = true;
    }
  }

  /**
   * Fetch all collections from Bunny CDN and cache them
   * @returns {Promise<Array>} List of all collections
   */
  async getAllCollections() {
    const cacheKey = 'bunny_all_collections';
    const cachedCollections = collectionsCache.get(cacheKey);
    
    if (cachedCollections) {
      this.allCollections = cachedCollections;
      return cachedCollections;
    }

    try {
      // First request to get total items and pages
      const initialResponse = await axios.get(
        `${this.apiUrl}/${this.libraryId}/collections?page=1&itemsPerPage=100`,
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
            `${this.apiUrl}/${this.libraryId}/collections?page=${page}&itemsPerPage=100`,
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
      collectionsCache.set(cacheKey, allItems);
      this.allCollections = allItems;
      this.collectionsInitialized = true;
      return allItems;
    } catch (error) {
      console.error(`🐰 Error fetching collections from Bunny Stream: ${error.message}`);
      return [];
    }
  }

  /**
   * Get a collection by name
   * @param {string} name - The name of the collection
   * @returns {Object|null} - The collection or null if not found
   */
  async getCollectionByName(name) {
    if (!this.collectionsInitialized) {
      await this.getAllCollections();
    }
    
    // Normalize search name
    const normalizedSearchName = this.normalizeTitle(name);
    
    // FIXED: Use exact matching only - no partial matches for collection names
    const collection = this.allCollections.find(c => 
      this.normalizeTitle(c.name) === normalizedSearchName
    );
    
    return collection || null;
  }
  
  /**
   * Create a new collection
   * @param {string} name - The name of the collection
   * @returns {Promise<Object>} - The created collection
   */
  async createCollection(name) {
    try {
      console.log(`🐰 Creating new collection: ${name}`);
      
      // FIXED: Force refresh collections before checking
      await this.refreshCollectionList();
      
      // Check if collection already exists
      const existingCollection = await this.getCollectionByName(name);
      if (existingCollection) {
        console.log(`�� Collection already exists: ${name}`);
        return existingCollection;
      }
      
      const response = await axios.post(
        `${this.apiUrl}/${this.libraryId}/collections`,
        { name },
        {
          headers: {
            'AccessKey': this.accessKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`🐰 Collection created: ${name}`);
      
      // FIXED: Always force refresh collections after creating a new one
      await this.refreshCollectionList();
      
      // FIXED: Get collection directly from the response
      return response.data;
    } catch (error) {
      console.error(`🐰 Error creating collection: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Force refresh the collections list
   */
  async refreshCollectionList() {
    collectionsCache.del('bunny_all_collections');
    this.collectionsInitialized = false;
    await this.getAllCollections();
  }
  
  /**
   * Add a video to a collection
   * @param {string} videoId - The ID of the video
   * @param {string} collectionId - The ID of the collection
   * @returns {Promise<Object>} - Response from Bunny Stream API
   */
  async addVideoToCollection(videoId, collectionId) {
    try {
      console.log(`🐰 Adding video ${videoId} to collection ${collectionId}`);

      // This is the correct endpoint - we need to use PATCH and add the video at the collection level
      const response = await axios.patch(
        `${this.apiUrl}/${this.libraryId}/collections/${collectionId}`,
        {
          videoIds: [videoId]
        },
        {
          headers: {
            'AccessKey': this.accessKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`🐰 Successfully added video to collection`);
      return response.data;
    } catch (error) {
      console.error(`🐰 Error adding video to collection: ${error.message}`);
      if (error.response) {
        console.error(`🐰 Response status: ${error.response.status}, data:`, error.response.data);
      }
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get videos in a collection
   * @param {string} collectionId - The ID of the collection
   * @returns {Promise<Array>} - List of videos in the collection
   */
  async getCollectionVideos(collectionId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${this.libraryId}/collections/${collectionId}/videos`,
        {
          headers: {
            'AccessKey': this.accessKey,
            'accept': 'application/json'
          }
        }
      );
      
      return response.data.items || [];
    } catch (error) {
      console.error(`🐰 Error getting collection videos: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Normalize title for comparison
   * @param {string} title - Title to normalize
   * @returns {string} - Normalized title
   */
  normalizeTitle(title) {
    if (!title) return '';
    
    // FIXED: Enhanced normalization logic
    return title
      .trim()
      .toLowerCase()
      .replace(/[\s\-_]+/g, ' ')  // Normalize spaces, dashes, underscores
      .replace(/[^\w\s\u0600-\u06FF]/g, '') // Keep only alphanumeric, spaces and Arabic chars
      .trim();
  }

  /**
   * Upload a video to a collection
   * @param {string} videoUrl - URL of the video to upload
   * @param {Object} metadata - Metadata for the video
   * @returns {Promise<Object>} - Response from Bunny Stream API
   */
  async uploadVideoToCollection(videoUrl, metadata = {}) {
    try {
      // Skip if URL is vip_only.mp4
      if (videoUrl.includes('vip_only.mp4')) {
        console.log(`🐰 Skipping upload of restricted content`);
        return { 
          success: false, 
          error: 'Restricted content (vip_only.mp4) not uploaded',
          isRestricted: true
        };
      }

      // Extract needed metadata
      const { title, type, tmdbId, season, episode, quality } = metadata;
      
      // Generate full title
      const fullTitle = this.generateTitle(title, type, season, episode, quality);
      
      // Check cache for previous upload
      const cacheKey = `bunny_upload_${videoUrl}`;
      const cachedResponse = bunnyCache.get(cacheKey);
      
      if (cachedResponse) {
        console.log(`🐰 Using cached response for ${fullTitle}`);
        return cachedResponse;
      }

      // Check if video already exists
      if (await this.videoExists(fullTitle)) {
        console.log(`🐰 Video "${fullTitle}" already exists`);
        return {
          success: false,
          error: 'Video already exists',
          exists: true,
          title: fullTitle
        };
      }

      // Get or create appropriate collection before upload
      let collectionId = null;
      let collectionName = null;
      
      if (type === 'tv' && title) {
        // TV shows - Use series title as collection name
        collectionName = `${title} (TV Series)`;
        const collection = await this.getCollectionByName(collectionName);
        if (collection) {
          collectionId = collection.guid;
          console.log(`🐰 Using existing collection: ${collectionName} (${collectionId})`);
        } else {
          // Create new collection
          console.log(`🐰 Creating new collection: ${collectionName}`);
          const newCollection = await this.createCollection(collectionName);
          if (newCollection && newCollection.guid) {
            collectionId = newCollection.guid;
          }
        }
      } else if (type === 'movie' && title) {
        // For movie series, check if it's part of a collection
        // This is a simple implementation - you might want to use TMDB API to get collection info
        const movieTitle = title.split(/[:(]/)[0].trim(); // Extract base title
        if (movieTitle) {
          collectionName = `${movieTitle} (Movies)`;
          const collection = await this.getCollectionByName(collectionName);
          if (collection) {
            collectionId = collection.guid;
          } else {
            // Only create collection if it's explicitly a multi-part movie
            if (title.match(/part|chapter|episode|\d+$/i)) {
              console.log(`🐰 Creating movie collection: ${collectionName}`);
              const newCollection = await this.createCollection(collectionName);
              if (newCollection && newCollection.guid) {
                collectionId = newCollection.guid;
              }
            }
          }
        }
      }

      // Upload the video to Bunny Stream, including collection assignment
      console.log(`🐰 Uploading: ${fullTitle}${collectionId ? ' to collection: ' + collectionName : ''}`);
      
      const uploadData = {
        url: videoUrl,
        title: fullTitle
      };
      
      // Add collection ID to request if available - THIS IS THE KEY PART - adding to collection at upload time
      if (collectionId) {
        uploadData.collectionId = collectionId;
      }
      
      const response = await axios.post(
        `${this.apiUrl}/${this.libraryId}/videos`,
        uploadData,
        {
          headers: {
            'AccessKey': this.accessKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Cache successful response
      bunnyCache.set(cacheKey, response.data);
      
      // Refresh our video list
      this.initialized = false;
      
      console.log(`🐰 Upload success: ${fullTitle} (ID: ${response.data.guid})`);
      return response.data;
    } catch (error) {
      console.error(`🐰 Upload error: ${error.message}`);
      if (error.response) {
        console.error(`🐰 Response status: ${error.response.status}, data:`, error.response.data);
      }
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Helper to generate a consistent title
   */
  generateTitle(title, type, season, episode, quality) {
    let fullTitle = title || 'Untitled Video';
    
    if (type === 'tv' && season && episode) {
      fullTitle += ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }
    
    if (quality) {
      fullTitle += ` [${quality}]`;
    }
    
    return fullTitle;
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
      console.error(`🐰 Error fetching videos: ${error.message}`);
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
      this.normalizeTitle(video.title) === this.normalizeTitle(title)
    );
  }

  /**
   * Upload a video to Bunny Stream by providing a URL
   * @param {string} videoUrl - The URL of the video to upload
   * @param {string} title - Optional title for the video
   * @returns {Promise<Object>} - Response from Bunny Stream API
   */
  async uploadVideoByUrl(videoUrl, title = '') {
    // For backwards compatibility, convert to new method
    return this.uploadVideoToCollection(videoUrl, { title });
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
      console.error(`🐰 Error getting video status: ${error.message}`);
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