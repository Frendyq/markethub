FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mock-marketplaces/package.json apps/mock-marketplaces/
RUN pnpm install --frozen-lockfile --filter @markethub/mock-marketplaces...
COPY apps/mock-marketplaces apps/mock-marketplaces
RUN pnpm --filter @markethub/mock-marketplaces build \
 && pnpm --filter @markethub/mock-marketplaces deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/mock-marketplaces/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
