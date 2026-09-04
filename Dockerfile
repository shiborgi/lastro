FROM oven/bun:1.4-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps apps
COPY packages packages
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY package.json tsconfig.json turbo.json ./
RUN bun run build

FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/turbo.json ./turbo.json
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
ENV NODE_ENV=production
CMD ["bun", "apps/api/src/index.ts"]
