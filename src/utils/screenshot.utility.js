import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

class ScreenshotUtility {
  constructor() {
    this.screenshotsDir = './screenshots';
    this.clientId = '77509d00769a145'; // Imgur API client ID
    this.pendingUploads = []; // Store screenshots for batch upload
    
    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }
  
  /**
   * Take a screenshot and store it for later batch upload or upload immediately
   * @param {Object} page - Puppeteer page object
   * @param {string} name - Screenshot name/description
   * @param {boolean} uploadImmediately - Whether to upload immediately or batch
   * @returns {Promise<Object|null>} - Screenshot info or null if failed
   */
  async captureScreenshot(page, name, uploadImmediately = false) {
    try {
      const timestamp = Date.now();
      const filename = `${name.replace(/\s+/g, '-')}-${timestamp}.png`;
      const screenshotPath = path.join(this.screenshotsDir, filename);
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved: ${screenshotPath}`);
      
      if (uploadImmediately) {
        const imgurUrl = await this.uploadToImgur(screenshotPath);
        return { name, path: screenshotPath, url: imgurUrl };
      } else {
        // Store for batch upload
        this.pendingUploads.push({
          path: screenshotPath,
          name: name
        });
        return { name, path: screenshotPath, pending: true };
      }
    } catch (error) {
      console.error(`Error capturing screenshot: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Upload a screenshot to Imgur
   * @param {string} screenshotPath - Path to the screenshot file
   * @returns {Promise<string|null>} - URL of the uploaded image
   */
  async uploadToImgur(screenshotPath) {
    try {
      const formData = new FormData();
      formData.append('image', fs.createReadStream(screenshotPath));
      
      const response = await axios.post('https://api.imgur.com/3/upload', formData, {
        headers: {
          'Authorization': `Client-ID ${this.clientId}`,
          ...formData.getHeaders()
        }
      });
      
      if (response.data.success) {
        console.log(`Screenshot uploaded to Imgur: ${response.data.data.link}`);
        
        // Clean up local file after upload
        fs.unlinkSync(screenshotPath);
        
        return response.data.data.link;
      } else {
        console.error('Imgur upload failed:', response.data);
        return null;
      }
    } catch (error) {
      console.error(`Error uploading to Imgur: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Upload all pending screenshots to Imgur in parallel
   * @returns {Promise<Array>} - Array of uploaded image info
   */
  async uploadPendingScreenshots() {
    if (this.pendingUploads.length === 0) {
      return [];
    }
    
    console.log(`Batch uploading ${this.pendingUploads.length} screenshots to Imgur...`);
    
    const uploadedScreenshots = [];
    
    // Upload in parallel for speed
    const uploadPromises = this.pendingUploads.map(async (screenshot) => {
      const url = await this.uploadToImgur(screenshot.path);
      if (url) {
        uploadedScreenshots.push({
          name: screenshot.name,
          url: url
        });
      }
    });
    
    await Promise.all(uploadPromises);
    
    // Clear pending uploads
    this.pendingUploads = [];
    
    console.log(`Successfully uploaded ${uploadedScreenshots.length} screenshots`);
    return uploadedScreenshots;
  }
}

export const screenshotUtility = new ScreenshotUtility(); 