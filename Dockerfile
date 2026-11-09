# Debian slim, not Alpine: onnxruntime-node (used by @huggingface/transformers) needs glibc.

# ---- build stage ----
FROM node:24.22.2-bookworm-slim AS build
# better-sqlite3 ships prebuilt binaries, but npm still runs node-gyp on install, which needs Python.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:24.22.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY config ./config
# data/ holds the SQLite match cache and the embedding model. docker-compose mounts a volume here.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "dist/index.js"]
