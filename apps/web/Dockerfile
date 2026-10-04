# syntax=docker/dockerfile:1.7
# Builds the PWA and serves it with Caddy (TLS, security headers, /api reverse proxy).
#   docker build -f apps/web/Dockerfile -t bankforall-web \
#     --build-arg VITE_CHAIN_ID=8453 \
#     --build-arg VITE_FORWARDER_ADDRESS=0x… --build-arg VITE_FACTORY_ADDRESS=0x… .
# The chain and contract addresses are pinned into the bundle: the app refuses to sign anything
# for another chain/forwarder/factory, even if the API says otherwise.
# Optional: --build-arg VITE_APP_NAME="…" [--build-arg VITE_APP_SHORT_NAME="…"] (default "Bank For All").
FROM node:24-trixie-slim AS build
ARG VITE_CHAIN_ID
ARG VITE_FORWARDER_ADDRESS
ARG VITE_FACTORY_ADDRESS
ARG VITE_APP_NAME=""
ARG VITE_APP_SHORT_NAME=""
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
# terms of use and privacy policy are bundled into the app (/terms, /privacy)
COPY docs/legal docs/legal
RUN test -n "$VITE_CHAIN_ID" && test -n "$VITE_FORWARDER_ADDRESS" && test -n "$VITE_FACTORY_ADDRESS" \
    || { echo "VITE_CHAIN_ID, VITE_FORWARDER_ADDRESS and VITE_FACTORY_ADDRESS build args are required" >&2; exit 1; }
RUN pnpm --filter @bankforall/shared build && \
    VITE_CHAIN_ID="$VITE_CHAIN_ID" VITE_FORWARDER_ADDRESS="$VITE_FORWARDER_ADDRESS" VITE_FACTORY_ADDRESS="$VITE_FACTORY_ADDRESS" \
    VITE_APP_NAME="$VITE_APP_NAME" VITE_APP_SHORT_NAME="$VITE_APP_SHORT_NAME" \
    pnpm --filter @bankforall/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
