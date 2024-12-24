import NodeCache from 'node-cache';
import fetch from 'node-fetch';

const cache = new NodeCache();

const TMDB_API_KEY = 'b29bfe548cc2a3e4225effbd54ef0fda';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w200';
const BACKDROP_BASE_URL = 'https://image.tmdb.org/t/p/original';
const CACHE_TTL = 60 * 60; // 1 hour in seconds

async function getCachedData(key, fetchFunction) {
  const cachedData = cache.get(key);
  if (cachedData) {
    return cachedData;
  }

  const freshData = await fetchFunction();
  cache.set(key, freshData, CACHE_TTL);
  return freshData;
}

async function getTrendingPosters() {
  try {
    const pages = await Promise.all([
      fetch(`${TMDB_BASE_URL}/trending/all/week?api_key=${TMDB_API_KEY}&page=1`),
      fetch(`${TMDB_BASE_URL}/trending/all/week?api_key=${TMDB_API_KEY}&page=2`),
      fetch(`${TMDB_BASE_URL}/trending/all/week?api_key=${TMDB_API_KEY}&page=3`)
    ].map(p => p.then(res => res.json())));

    const posters = pages.flatMap(page => 
      page.results
        .filter(item => item.poster_path)
        .map(item => ({
          id: item.id,
          poster: `${POSTER_BASE_URL}${item.poster_path}`,
          title: item.title || item.name
        }))
    );

    return posters;
  } catch (error) {
    console.error('Error fetching trending posters:', error);
    throw error;
  }
}

async function getRandomBackdrops() {
  try {
    const response = await fetch(`${TMDB_BASE_URL}/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&page=1`);
    const data = await response.json();
    const movies = data.results.filter(movie => movie.backdrop_path);
    
    const randomLeft = movies[Math.floor(Math.random() * movies.length)];
    let randomRight;
    do {
      randomRight = movies[Math.floor(Math.random() * movies.length)];
    } while (randomRight === randomLeft);

    return {
      left: `${BACKDROP_BASE_URL}${randomLeft.backdrop_path}`,
      right: `${BACKDROP_BASE_URL}${randomRight.backdrop_path}`
    };
  } catch (error) {
    console.error('Error fetching random backdrops:', error);
    throw error;
  }
}

export const tmdbController = {
  async getTrendingPosters(req, res) {
    try {
      const posters = await getCachedData('trending-posters', getTrendingPosters);
      res.json(posters);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch trending posters' });
    }
  },

  async getRandomBackdrops(req, res) {
    try {
      // Don't cache random backdrops since they should be different each time
      const backdrops = await getRandomBackdrops();
      res.json(backdrops);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch random backdrops' });
    }
  }
};