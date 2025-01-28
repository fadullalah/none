import cloudscraper
import requests
import json
from urllib.parse import quote
from bs4 import BeautifulSoup
import re

# Cloudflare bypass scraper
scraper = cloudscraper.create_scraper()

class ShowBox:
    def __init__(self):
        self.scraper = cloudscraper.create_scraper()

    def get_share_key(self, movie_id, media_type='movie'):
        """
        Fetches the share key for a movie or TV show.
        """
        type_code = '1' if media_type == 'movie' else '2'
        url = f'https://showbox.media/index/share_link?id={movie_id}&type={type_code}'
        
        try:
            response = self.scraper.get(url)
            response.raise_for_status()  # Raise an error for bad status codes
            
            # Debugging: Print the response content
            print("Response Content:", response.text)
            
            # Parse JSON response
            movie_data = response.json()
            return movie_data['data']['link'].split('/share/')[1]
        except Exception as e:
            print(f"Error getting share key: {e}")
        return None

    def get_name(self, media_id, season=None, episode=None):
        """
        Fetches the name of the movie or TV show using the TMDB API.
        """
        api_key = 'f1dd7f2494de60ef4946ea81fd5ebaba'
        if season or episode:
            base_url = 'https://api.themoviedb.org/3/tv/'
        else:
            base_url = 'https://api.themoviedb.org/3/movie/'
        endpoint = f'{media_id}?api_key={api_key}&language=en-US'
        
        try:
            response = requests.get(base_url + endpoint)
            response.raise_for_status()
            data = response.json()
            return data.get('name' if season or episode else 'title', 'Unknown')
        except Exception as e:
            print(f"Error fetching name: {e}")
        return None

    def fetch_movie_data_by_name(self, name):
        """
        Searches for a movie or TV show by name and returns its ID.
        """
        target_url = f"https://showbox.media/search?keyword={quote(name)}"
        headers = {
            "Referer": "https://showbox.media/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        
        try:
            response = self.scraper.get(target_url, headers=headers)
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                for movie_div in soup.find_all("div", class_="flw-item"):
                    title = movie_div.find("a", class_="film-poster-ahref").get("title", "")
                    if title.lower() == name.lower():
                        movie_url = movie_div.find("a", class_="film-poster-ahref")["href"]
                        detail_url = f"https://showbox.media{movie_url}"
                        detail_response = self.scraper.get(detail_url, headers=headers)
                        if detail_response.status_code == 200:
                            detail_soup = BeautifulSoup(detail_response.content, 'html.parser')
                            movie_id_tag = detail_soup.find("h2", class_="heading-name")
                            if movie_id_tag:
                                return movie_id_tag.find("a")["href"].split("/")[-1]
        except Exception as e:
            print(f"Error fetching movie data: {e}")
        return None

    def get_download_link(self, share_key, media_type, season=None):
        """
        Fetches the download link for a movie or TV show.
        """
        url = f'https://www.febbox.com/file/share_info?key={share_key}'
        try:
            response = self.scraper.get(url)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                if media_type == 'tv' and season:
                    season_div = soup.find("div", {"data-path": f"season {season}"})
                    if season_div:
                        return season_div['data-id']
                else:
                    first_file = soup.select_one('.file')
                    return first_file['data-id'] if first_file else None
        except Exception as e:
            print(f"Error getting download link: {e}")
        return None

    def get_stream_links(self, fid, share_key):
        """
        Fetches streaming links for a movie or TV show.
        """
        url = "https://www.febbox.com/console/player"
        headers = {
            "Referer": "https://www.febbox.com/console",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        try:
            response = self.scraper.post(url, headers=headers, data={"fid": fid})
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                script = soup.find('script', string=re.compile('var sources ='))
                if script:
                    sources = json.loads(re.search(r'var sources = (\[.*?\]);', script.string).group(1))
                    return [{"file": s['file'], "label": s['label']} for s in sources if s['type'] == 'video/mp4']
        except Exception as e:
            print(f"Error getting stream links: {e}")
        return []

    def fetch_sources(self, media_id, media_type, season=None, episode=None):
        """
        Fetches streaming sources for a movie or TV show.
        """
        try:
            if media_type == 'tv':
                media_name = self.get_name(media_id, season, episode)
                share_key = self.get_share_key(self.fetch_movie_data_by_name(media_name), 'tv')
                fid = self.get_download_link(share_key, 'tv', season)
            else:
                media_name = self.get_name(media_id)
                share_key = self.get_share_key(self.fetch_movie_data_by_name(media_name))
                fid = self.get_download_link(share_key, 'movie')

            return {"sources": self.get_stream_links(fid, share_key)} if fid else {}
        except Exception as e:
            print(f"Error fetching sources: {e}")
        return {}

if __name__ == "__main__":
    showbox = ShowBox()
    
    # CLI Interface
    task = input("What do you want to watch? (movie/tv): ").lower()
    while task not in ['movie', 'tv']:
        task = input("Invalid choice. Please enter 'movie' or 'tv': ").lower()
    
    media_id = input("Enter TMDB ID: ")
    while not media_id.isdigit():
        media_id = input("Invalid ID. Enter numeric TMDB ID: ")
    
    season = episode = None
    if task == 'tv':
        choice = input("Get all episodes or specific? (all/specific): ").lower()
        if choice == 'specific':
            season = input("Enter season number: ")
            while not season.isdigit():
                season = input("Invalid season. Enter a number: ")
            
            episode = input("Enter episode number: ")
            while not episode.isdigit():
                episode = input("Invalid episode. Enter a number: ")
    
    result = showbox.fetch_sources(
        media_id=int(media_id),
        media_type=task,
        season=int(season) if season else None,
        episode=int(episode) if episode else None
    )
    
    print("\nResults:")
    print(json.dumps(result, indent=2) if result else "No results found")