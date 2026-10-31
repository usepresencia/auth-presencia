FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3340
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3340
CMD ["node", "dist/main.js"]
