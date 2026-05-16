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

# Worker default port. ROLES MUST be supplied at runtime — no default.
ENV NODE_ENV=production
EXPOSE 4002

CMD ["node", "dist/main"]
