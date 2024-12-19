import fetch from 'node-fetch';

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