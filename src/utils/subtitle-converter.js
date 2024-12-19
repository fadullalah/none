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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch subtitles');
    }
    
    const srtContent = await response.text();
    return await convertSrtToVtt(srtContent);
  } catch (error) {
    console.error('Error processing subtitles:', error);
    throw error;
  }
}