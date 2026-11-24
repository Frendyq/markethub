# Build context: the repository root (pnpm workspace).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @markethub/api...
COPY apps/api apps/api
RUN pnpm --filter @markethub/api exec prisma generate \
 && pnpm --filter @markethub/api build \
 && pnpm --filter @markethub/api deploy --prod --legacy /out

# Migrations and seed run from the build stage, which still has the Prisma CLI.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed"]

# Runtime: production dependencies and compiled code only. The same image runs the API and the worker.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
