# Cyfers — Next.js development image (browser UI; Electron/SSO stay on the host).
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    CYFERS_DESKTOP=1 \
    CYFERS_DATA_DIR=/app/data \
    WATCHPACK_POLLING=true \
    CHOKIDAR_USEPOLLING=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY scripts/ensure-electron.js scripts/ensure-electron.js

RUN npm ci

COPY . .

RUN mkdir -p /app/data/plugins

EXPOSE 3000

CMD ["npx", "next", "dev", "-H", "0.0.0.0", "-p", "3000"]
