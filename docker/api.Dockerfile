FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg libheif-examples fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY api/migrations ./migrations
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod 755 /usr/local/bin/api-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "dist/index.js"]
