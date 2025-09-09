#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';

console.log('🎬 Starting IMDB Movie Database Setup...\n');

const scriptPath = path.join(process.cwd(), 'src', 'scripts', 'imdb-to-sqlite.js');

const child = spawn('node', [scriptPath], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ IMDB setup completed successfully!');
    console.log('📊 You can now use the movie API endpoints:');
    console.log('   - GET /api/movies/search?q=batman');
    console.log('   - GET /api/movies/year/2023');
    console.log('   - GET /api/movies/genre/action');
    console.log('   - GET /api/movies/random/10');
    console.log('   - GET /api/movies/stats/overview');
  } else {
    console.log(`\n❌ IMDB setup failed with exit code ${code}`);
    process.exit(code);
  }
});

child.on('error', (err) => {
  console.error('❌ Error running IMDB setup:', err);
  process.exit(1);
});
