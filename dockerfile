# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node@sha256: 43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm ci \
    --workspace=server \
    --include-workspace-root=false \
    --omit=dev

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/server ./server

COPY --chown=node:node server ./server

WORKDIR /app/server

USER node

EXPOSE 3000

CMD ["node", "index.js"]