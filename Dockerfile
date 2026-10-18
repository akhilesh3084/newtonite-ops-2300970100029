# syntax=docker/dockerfile:1

FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY server/package.json server/package-lock.json* ./server/
WORKDIR /app/server
RUN npm install

# --- web build (placeholder until Phase 7; empty dist is fine) ---
FROM base AS web-build
COPY web/package.json web/package-lock.json* ./web/
WORKDIR /app/web
RUN if [ -f package.json ]; then npm install; else mkdir -p dist && echo '<!doctype html><title>ops</title><p>API is up. Frontend coming in Phase 7.</p>' > dist/index.html; fi
COPY web/ ./
RUN if [ -f package.json ] && grep -q '"build"' package.json; then npm run build; else mkdir -p dist && printf '%s\n' '<!doctype html><html><head><meta charset="utf-8"><title>Operations Under Pressure</title></head><body><h1>Operations Under Pressure</h1><p>API is running. Frontend lands in Phase 7.</p></body></html>' > dist/index.html; fi

# --- server build ---
FROM deps AS server-build
WORKDIR /app/server
COPY server/ ./
RUN npx prisma generate && npm run build

# --- migrate (one-shot) ---
FROM server-build AS migrate
WORKDIR /app/server
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# --- runtime ---
FROM base AS runtime
WORKDIR /app/server
COPY --from=server-build /app/server/package.json ./
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=web-build /app/web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
