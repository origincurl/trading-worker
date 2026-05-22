# syntax=docker/dockerfile:1.6

# Builder stage — compile TypeScript with dev deps available.
FROM node:20-alpine AS builder
WORKDIR /app

# Cache dependency layer separately from source.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY tsconfig*.json nest-cli.json eslint.config.mjs ./
COPY src ./src

RUN yarn build

# Strip dev deps for the runtime stage.
RUN yarn install --frozen-lockfile --production --network-timeout 600000

# Runtime stage — slim, non-root.
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S worker && adduser -S worker -G worker

COPY --from=builder --chown=worker:worker /app/node_modules ./node_modules
COPY --from=builder --chown=worker:worker /app/dist ./dist
COPY --from=builder --chown=worker:worker /app/package.json ./

USER worker

# Worker default listen port — 실제 listen 포트는 runtime PORT env 가 결정 (compose 가 WORKER_PORT 값을 주입).
# EXPOSE 는 metadata 라 동작에 영향 없지만, 운영 WORKER_PORT 와 일치시켜 혼동 방지.
# ROLES MUST be supplied at runtime — no default.
ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "dist/main"]
