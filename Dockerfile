# syntax=docker/dockerfile:1.7

FROM node:24.12.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json svelte.config.js tsconfig.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
COPY . .
RUN npm run build
# The production image has no TypeScript toolchain, so the catalog seed is
# bundled here and keeps sharing the plan definitions with the application.
RUN npx esbuild scripts/seed.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --outfile=production-scripts/seed.mjs

FROM node:24.12.0-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/production-scripts/seed.mjs ./scripts/seed.mjs
COPY --from=build /app/scripts/monitoring-worker.mjs ./scripts/monitoring-worker.mjs
COPY --from=build /app/scripts/reconciliation-worker.mjs ./scripts/reconciliation-worker.mjs
COPY --from=build /app/scripts/telegram-setup.mjs ./scripts/telegram-setup.mjs
# Operator diagnostics run inside this image: both are documented as
# `exec app node scripts/...` and are unusable if they are left out.
COPY --from=build /app/scripts/vpn-diagnose.mjs ./scripts/vpn-diagnose.mjs
COPY --from=build /app/scripts/xray-core-logs.mjs ./scripts/xray-core-logs.mjs
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "build"]

FROM restic/restic:0.18.1@sha256:b43f00a24d9b2d9affb332a29d57042563eeb61219ae1a36dfccbdc34fbaa6b3 AS restic

FROM node:24.12.0-alpine AS operations
WORKDIR /app
RUN apk add --no-cache python3
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY deployment ./deployment
COPY drizzle ./drizzle
COPY scripts/backup.py scripts/backup_lib.py scripts/backup_worker.py scripts/local_backup_restore_drill.py scripts/restore_drill.py ./scripts/
ENTRYPOINT []
CMD ["python3", "scripts/backup_worker.py"]
