FROM node:18-alpine

# Install Chromium
RUN apk add --no-cache chromium

# Create working directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json package-lock.json ./
RUN npm install --omit=dev

# Copy source files
COPY . . 

# Add user for running the application
RUN addgroup -S pptruser && adduser -S pptruser -G pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /usr/src/app

# Environment variables
ENV PORT=3001
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV API_TOKEN=b29bfe548cc2a3e4225effbd54ef0fda
ENV UI_TOKENS=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1Mjc1NTIsIm5iZiI6MTczMTUyNzU1MiwiZXhwIjoxNzYyNjMxNTcyLCJkYXRhIjp7InVpZCI6MzYxNTkxLCJ0b2tlbiI6Ijc4NjdlYzc2NzcwODAyNjcxNWNlNTZjMWJiZDI1N2NkIn19.vXKdWeU8R_xe4gUMBg-hIxkftFogPdZEGtXvAw0IC-Q

# Run everything after as non-privileged user
USER pptruser

# Expose the port
EXPOSE 3001

# Start the application
CMD ["node", "src/app.js"]
