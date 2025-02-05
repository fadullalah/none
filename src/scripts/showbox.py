from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
from webdriver_manager.chrome import ChromeDriverManager
import time
import json
import sys

# Create a logger that writes to stderr
def log(message):
    print(message, file=sys.stderr, flush=True)

class FebBoxScraper:
    def __init__(self, ui_token, headless=False):
        log("Setting up Chrome browser...")
        chrome_options = Options()
        if headless:
            chrome_options.add_argument('--headless=new')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--autoplay-policy=no-user-gesture-required')

        self.driver = webdriver.Chrome(
            service=Service(ChromeDriverManager().install()),
            options=chrome_options
        )
        self.wait = WebDriverWait(self.driver, 20)
        self.ui_token = ui_token
        self.quality_priority = ['ORG', '4K', '2160P', '1440P', '1080P', '720P', '480P', '360P']
        log("Browser setup complete")

    def add_auth_cookie(self):
        log("Adding authentication cookie...")
        self.driver.add_cookie({
            'name': 'ui',
            'value': self.ui_token,
            'domain': '.febbox.com',
            'path': '/'
        })

    def wait_and_find_element(self, by, value, timeout=20):
        return WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((by, value))
        )

    def wait_for_video_player(self):
        """Wait for the video player to fully load"""
        try:
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "jw-media")))
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "jw-video")))
            time.sleep(3)
            return True
        except TimeoutException:
            return False

    def get_current_video_url(self):
        """Get the current video URL from the player"""
        try:
            video_element = self.wait.until(
                EC.presence_of_element_located((By.CLASS_NAME, "jw-video"))
            )
            url = video_element.get_attribute('src')
            return url if url and 'shegu.net' in url else None
        except Exception as e:
            log(f"Failed to get current video URL: {str(e)}")
            return None

    def hover_over_player(self):
        """Trigger mouseover and keep controls visible using JavaScript"""
        try:
            player = self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "jw-media")))

            try:
                ActionChains(self.driver).move_to_element(player).perform()
            except:
                pass

            self.driver.execute_script("""
                arguments[0].dispatchEvent(new Event('mouseover'));
                arguments[0].dispatchEvent(new Event('mousemove'));
            """, player)

            self.driver.execute_script("""
                document.querySelector('.jw-controls').style.opacity = '1';
                document.querySelector('.jw-controls').style.visibility = 'visible';
            """)

            time.sleep(0.5)
            return True
        except Exception as e:
            log(f"Error hovering over player: {str(e)}")
            return False

    def wait_for_quality_change(self, quality_label, previous_url, max_wait=15):
        """Wait for quality change confirmation"""
        start_time = time.time()
        while time.time() - start_time < max_wait:
            try:
                quality_button = self.driver.find_element(
                    By.CSS_SELECTOR,
                    f"button.jw-settings-content-item[aria-label='{quality_label}']"
                )
                if quality_button.get_attribute('aria-checked') == 'true':
                    current_url = self.get_current_video_url()
                    if current_url and current_url != previous_url:
                        return current_url
            except:
                pass
            time.sleep(1)
        return None

    def click_quality_button(self, button, retries=3):
        """Enhanced click handling with scroll into view"""
        for attempt in range(retries):
            try:
                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                time.sleep(0.2)
                button.click()
                return True
            except:
                try:
                    self.driver.execute_script("arguments[0].click();", button)
                    return True
                except:
                    try:
                        ActionChains(self.driver).move_to_element(button).click().perform()
                        return True
                    except:
                        if attempt == retries - 1:
                            return False
                        time.sleep(1)
        return False

    def get_all_quality_urls(self):
        try:
            max_hover_attempts = 3
            hover_success = False

            for i in range(max_hover_attempts):
                if self.hover_over_player():
                    hover_success = True
                    break
                time.sleep(1)

            if not hover_success:
                log("Failed to make player controls visible")
                return {}

            quality_urls = {}
            max_attempts = 3

            self.hover_over_player()
            settings_button = self.wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "div.jw-icon-settings"))
            )
            settings_button.click()
            time.sleep(1)

            quality_menu = self.wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "div.jw-settings-quality"))
            )
            quality_menu.click()
            time.sleep(1)

            quality_container = self.wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "div.jw-settings-submenu-quality"))
            )
            quality_buttons = quality_container.find_elements(By.CSS_SELECTOR, "button.jw-settings-content-item")
            quality_labels = [btn.get_attribute('aria-label') for btn in quality_buttons]

            sorted_qualities = sorted(
                quality_labels,
                key=lambda x: (
                    self.quality_priority.index(x)
                    if x in self.quality_priority
                    else len(self.quality_priority)
                )
            )

            log(f"Found qualities: {sorted_qualities}")

            for quality_label in sorted_qualities:
                if not quality_label or quality_label in quality_urls:
                    continue

                log(f"\nProcessing quality: {quality_label}")

                for attempt in range(max_attempts):
                    try:
                        self.hover_over_player()
                        settings_button = self.wait.until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, "div.jw-icon-settings"))
                        )
                        settings_button.click()
                        time.sleep(1)

                        quality_menu = self.wait.until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, "div.jw-settings-quality"))
                        )
                        quality_menu.click()
                        time.sleep(1)

                        quality_container = self.wait.until(
                            EC.presence_of_element_located((By.CSS_SELECTOR, "div.jw-settings-submenu-quality"))
                        )
                        buttons = quality_container.find_elements(By.CSS_SELECTOR, "button.jw-settings-content-item")
                        target_button = next(
                            (btn for btn in buttons if btn.get_attribute('aria-label') == quality_label),
                            None
                        )

                        if not target_button:
                            break

                        previous_url = self.get_current_video_url()
                        log(f"Clicking {quality_label} button...")

                        if self.click_quality_button(target_button):
                            log(f"Waiting for {quality_label} to load...")
                            new_url = self.wait_for_quality_change(quality_label, previous_url)

                            if new_url and new_url != previous_url:
                                quality_urls[quality_label] = new_url
                                log(f"Got unique URL for {quality_label}")
                                break
                            else:
                                log(f"Quality change failed for {quality_label}")

                    except Exception as e:
                        log(f"Attempt {attempt + 1} failed: {str(e)}")
                        if attempt < max_attempts - 1:
                            time.sleep(1)

            log(f"\nTotal qualities found: {len(quality_urls)}")
            return quality_urls

        except Exception as e:
            log(f"Error getting quality URLs: {str(e)}")
            return {}

    def process_single_file(self, file_info):
        """Process a single file after page refresh"""
        try:
            file_elements = self.wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div.file"))
            )

            target_file = next(
                (elem for elem in file_elements
                 if elem.get_attribute('data-id') == file_info['id']),
                None
            )

            if not target_file:
                log(f"Could not find file with ID: {file_info['id']}")
                return None

            log("Clicking file...")
            target_file.click()
            time.sleep(2)

            log("Clicking play button...")
            play_button = self.wait_and_find_element(
                By.CSS_SELECTOR,
                "img.play_img"
            )
            play_button.click()

            log("Waiting for video player...")
            if self.wait_for_video_player():
                log("Getting all quality URLs...")
                quality_urls = self.get_all_quality_urls()

                if quality_urls:
                    return {
                        'file_info': file_info,
                        'quality_urls': quality_urls
                    }

            return None

        except Exception as e:
            log(f"Error processing file: {str(e)}")
            return None

    def scrape_share(self, share_url):
        try:
            log("Setting up authentication...")
            self.driver.get("https://www.febbox.com")
            self.add_auth_cookie()

            log(f"Opening share URL: {share_url}")
            self.driver.get(share_url)

            log("Collecting file information...")
            file_elements = self.wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div.file"))
            )

            file_infos = []
            for elem in file_elements:
                try:
                    file_infos.append({
                        'id': elem.get_attribute('data-id'),
                        'name': elem.find_element(By.CSS_SELECTOR, "p.file_name").text,
                        'size': elem.find_element(By.CSS_SELECTOR, "p.file_size").text,
                        'type': elem.find_element(By.CSS_SELECTOR, "p.file_type").text
                    })
                except Exception as e:
                    log(f"Failed to get file info: {str(e)}")

            results = []
            for index, file_info in enumerate(file_infos, 1):
                log(f"\nProcessing file {index} of {len(file_infos)}")
                log(f"File: {file_info['name']}")
                log(f"Size: {file_info['size']}")
                log(f"Type: {file_info['type']}")
                log(f"ID: {file_info['id']}")

                self.driver.get(share_url)
                time.sleep(2)

                result = self.process_single_file(file_info)
                if result:
                    results.append(result)

            # Only output JSON data to stdout
            print(json.dumps(results), flush=True)
            return results

        except Exception as e:
            log(f"Error during scraping: {str(e)}")
            return []

    def close(self):
        log("\nClosing browser...")
        self.driver.quit()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        log("Usage: python script.py <share_url> <ui_token>")
        sys.exit(1)

    share_url = sys.argv[1]
    ui_token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1MjUzNjQsIm5iZiI6MTczMTUyNTM2NCwiZXhwIjoxNzYyNjI5Mzg0LCJkYXRhIjp7InVpZCI6Mzc2ODAyLCJ0b2tlbiI6IjM4OTc3Zjk2YTMxMTM2YTMxYjUwYjFmOThmMTEwYjMxIn19.ChQp8PLWl03GPfWyID35a35u0Cmw6bNoHKDhuScoEU0'

    log("Starting FebBox scraper...")
    scraper = FebBoxScraper(ui_token, headless=False)

    try:
        results = scraper.scrape_share(share_url)
    finally:
        scraper.close()