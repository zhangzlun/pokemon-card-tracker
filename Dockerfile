FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY scripts ./scripts
COPY site ./site
COPY data/watchlist.json data/japan-sources.json data/aliases.json data/comparison-sources.json ./data/
ENV NODE_ENV=production TRACKER_ROOT=/storage PORT=5173 TZ=Asia/Taipei
EXPOSE 5173
CMD ["node", "scripts/nas.mjs"]
