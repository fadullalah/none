FROM ghcr.io/puppeteer/puppeteer:19.7.5

USER root

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/app.js"]