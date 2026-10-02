# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f apps/api/Dockerfile -t bankforall-api .
FROM node:24-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @bankforall/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @bankforall/shared build \
 && pnpm --filter @bankforall/api exec prisma generate \
 && pnpm --filter @bankforall/api build \
 && pnpm --filter @bankforall/api deploy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# same image runs the API (default), the worker (`node dist/worker.js`) and migrations (`npx prisma migrate deploy`)
CMD ["node", "dist/server.js"]
