# syntax=docker/dockerfile:1.7
# Builds the PWA and serves it with Caddy (TLS, security headers, /api reverse proxy).
#   docker build -f apps/web/Dockerfile -t bankforall-web .
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @bankforall/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @bankforall/shared build && pnpm --filter @bankforall/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
