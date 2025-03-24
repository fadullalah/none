import fetch from 'node-fetch';

// OpenSubtitles API constants
const OPENSUBTITLES_API_URL = 'https://api.opensubtitles.com/api/v1';
const OPENSUBTITLES_API_KEY = 'drupqioVLb3rucC2NzZw7OC7qLkE2uPO';
const USER_AGENT = 'MovieStreaming v1.0';

export async function convertSrtToVtt(srtContent) {
  // Replace CRLF with LF for consistent processing
  let content = srtContent.replace(/\r\n/g, '\n');
  
  // Split into lines
  let lines = content.split('\n');
  
  // Add WebVTT header
  let vttContent = 'WEBVTT\n\n';
  
  let currentBlock = [];
  let isFirstBlock = true;
  
  for (let line of lines) {
    // Skip empty lines at the start
    if (isFirstBlock && line.trim() === '') continue;
    
    // If we encounter a numeric index at the start of a block
    if (/^\d+$/.test(line.trim())) {
      if (currentBlock.length > 0) {
        vttContent += currentBlock.join('\n') + '\n\n';
        currentBlock = [];
      }
      isFirstBlock = false;
      continue;
    }
    
    // Convert SRT timestamps to VTT format
    if (line.includes('-->')) {
      line = line.replace(/,/g, '.');
    }
    
    currentBlock.push(line);
  }
  
  // Add the last block
  if (currentBlock.length > 0) {
    vttContent += currentBlock.join('\n') + '\n\n';
  }
  
  return vttContent;
}

export async function fetchAndConvertSubtitles(url) {
  try {
    console.log('Attempting to fetch subtitles from:', url);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000, // 10 second timeout
      follow: 5 // Allow up to 5 redirects
    });

    if (!response.ok) {
      console.error('Fetch failed with status:', response.status);
      console.error('Response headers:', response.headers);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log('Fetch successful, content type:', response.headers.get('content-type'));
    const srtContent = await response.text();
    
    if (!srtContent || srtContent.trim().length === 0) {
      throw new Error('Empty subtitle content received');
    }
    
    console.log('Content length:', srtContent.length);
    return await convertSrtToVtt(srtContent);
  } catch (error) {
    console.error('Detailed fetch error:', {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack
    });
    throw new Error(`Failed to fetch subtitles: ${error.message}`);
  }
}

// New OpenSubtitles API functions
export async function searchSubtitles(params) {
  console.log('Searching for subtitles with params:', params);
  
  // Build query params
  const queryParams = new URLSearchParams();
  
  // Add all provided parameters to the query
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      queryParams.append(key, value);
    }
  });
  
  try {
    const response = await fetch(`${OPENSUBTITLES_API_URL}/subtitles?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenSubtitles API search error:', {
        status: response.status,
        statusText: response.statusText,
        errorData
      });
      throw new Error(`OpenSubtitles API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.data?.length || 0} subtitles`);
    return data;
  } catch (error) {
    console.error('Failed to search subtitles:', error);
    throw error;
  }
}

export async function downloadSubtitle(fileId) {
  console.log('Downloading subtitle with file ID:', fileId);
  
  try {
    // Request download URL
    const downloadResponse = await fetch(`${OPENSUBTITLES_API_URL}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file_id: fileId })
    });
    
    if (!downloadResponse.ok) {
      const errorData = await downloadResponse.json().catch(() => ({}));
      console.error('OpenSubtitles API download error:', {
        status: downloadResponse.status,
        statusText: downloadResponse.statusText,
        errorData
      });
      throw new Error(`OpenSubtitles API download error: ${downloadResponse.status} ${downloadResponse.statusText}`);
    }
    
    const downloadData = await downloadResponse.json();
    console.log('Download URL obtained:', downloadData.link);
    
    // Fetch the actual subtitle file
    const subtitleResponse = await fetch(downloadData.link);
    
    if (!subtitleResponse.ok) {
      throw new Error(`Failed to download subtitle file: ${subtitleResponse.status} ${subtitleResponse.statusText}`);
    }
    
    const subtitleContent = await subtitleResponse.text();
    
    // Check if the file is SRT and needs conversion to VTT
    let finalContent;
    if (downloadData.file_name.endsWith('.srt')) {
      finalContent = await convertSrtToVtt(subtitleContent);
    } else {
      finalContent = subtitleContent;
    }
    
    return {
      content: finalContent,
      fileName: downloadData.file_name,
      format: downloadData.file_name.split('.').pop(),
      originalLink: downloadData.link
    };
  } catch (error) {
    console.error('Failed to download subtitle:', error);
    throw error;
  }
}