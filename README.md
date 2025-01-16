To update the code for your React Vite scraper on your VPS (which uses Docker), you can follow these steps:

### 1. **SSH into your VPS**
First, connect to your VPS using SSH. You can do this from your local terminal:

```bash
ssh user@your-vps-ip
```

Replace `user` with your SSH username and `your-vps-ip` with your VPS's IP address.

### 2. **Navigate to your project directory**
Once logged in, navigate to the directory where your project is located (for example, `/var/www/scraper` or wherever your Docker container's code is stored).

```bash
cd /path/to/your/project
```

### 3. **Pull the latest code from GitHub**
If you've already pushed your updates to GitHub, you can pull the latest changes directly from the repository:

```bash
git pull origin main
```

Replace `main` with the appropriate branch name if you're working on another branch.

### 4. **Build the Docker image**
If your Docker setup uses a `Dockerfile`, you’ll need to rebuild the Docker image with the latest code:

```bash
docker build -t video-api .
```

Make sure you're in the correct directory where your `Dockerfile` is located.

### 5. **Stop the existing Docker container**
Stop the currently running Docker container to replace it with the updated one:

```bash
docker stop video-api
```

This stops the container with the name `video-api`. Replace `video-api` with the name of your container if it's different.

### 6. **Remove the old Docker container**
If you want to remove the old container before starting a new one (this is optional but can help avoid conflicts):

```bash
docker rm video-api
```

### 7. **Start the new Docker container**
Now that you've built the updated Docker image, you can start a new container with the updated code:

```bash
docker run -d -p 3001:3001 --name video-api video-api
```

This command runs the container in detached mode (`-d`), exposes port 3001 (`-p 3001:3001`), and uses the `video-api` image.

### 8. **Check the container status**
Make sure the new container is running properly:

```bash
docker ps
```

### 9. **Restart Nginx (if needed)**
If Nginx is acting as a reverse proxy for your Docker container, you may need to restart it to ensure it's correctly forwarding traffic:

```bash
sudo systemctl restart nginx
```

### 10. **Test your application**
Finally, verify that everything works correctly by visiting your site or testing the endpoints.

---

### Summary
1. SSH into your VPS.
2. Pull the latest code from GitHub using `git pull`.
3. Rebuild your Docker image.
4. Stop and remove the existing Docker container.
5. Start a new container with the updated code.
6. Restart Nginx (if necessary).
7. Test to ensure everything works.

Let me know if you need help with any specific step!