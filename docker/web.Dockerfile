FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ARG SITE_URL=http://127.0.0.1:4185
ARG PUBLIC_BASE_URL=http://127.0.0.1:4185
ENV SITE_URL=$SITE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4185 HOSTNAME=0.0.0.0
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/policy.mjs ./policy.mjs
COPY --from=build /app/next.config.js ./next.config.js
EXPOSE 4185
CMD ["node", "server.mjs"]
