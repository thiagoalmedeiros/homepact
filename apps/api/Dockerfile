FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci -w packages/shared -w apps/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared && npm run build -w apps/api

FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci -w packages/shared -w apps/api --omit=dev \
  && mkdir -p packages/shared/node_modules apps/api/node_modules

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --chown=node:node --from=deps /repo/node_modules ./node_modules
COPY --chown=node:node --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --chown=node:node --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --chown=node:node --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=build /repo/apps/api/package.json ./apps/api/
COPY --chown=node:node --from=build /repo/apps/api/dist ./apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT:-3000}/api/health" || exit 1
CMD ["node", "dist/server.js"]
