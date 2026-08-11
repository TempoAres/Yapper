FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY migrations ./migrations
COPY scripts ./scripts
COPY src ./src

RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache font-dejavu font-liberation

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations

USER node
CMD ["node", "dist/src/index.js"]
