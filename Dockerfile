# Build stage
FROM node:20-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Run stage
FROM node:20-slim
# Install Chrome dependencies and Chrome
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-khmeros fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
# Copy only production dependencies and source code
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app .

# Add user for running the application
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /usr/src/app

# Environment variables
ENV PORT=3001
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/google-chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV API_TOKEN=b29bfe548cc2a3e4225effbd54ef0fda
ENV UI_TOKENS=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MzE1Mjc1NTIsIm5iZiI6MTczMTUyNzU1MiwiZXhwIjoxNzYyNjMxNTcyLCJkYXRhIjp7InVpZCI6MzYxNTkxLCJ0b2tlbiI6Ijc4NjdlYzc2NzcwODAyNjcxNWNlNTZjMWJiZDI1N2NkIn19.vXKdWeU8R_xe4gUMBg-hIxkftFogPdZEGtXvAw0IC-Q
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Run everything after as non-privileged user
USER pptruser

EXPOSE 3001

RUN npm install -g pm2

CMD ["pm2-runtime", "start", "src/app.js", "-i", "8"]