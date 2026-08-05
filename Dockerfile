# Keep build and runtime aligned with .nvmrc and CI. The argument also makes
# deliberate patch-version updates easy to audit in release PRs.
ARG NODE_VERSION=26.5.1
ARG PNPM_VERSION=10.28.2

FROM node:${NODE_VERSION}-alpine AS build

ARG PNPM_VERSION

WORKDIR /app

# Node 26 images no longer bundle Corepack. Install the exact pnpm release
# declared by package.json instead of depending on an ambient package manager.
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm run build \
  && pnpm prune --prod --ignore-scripts

FROM node:${NODE_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="Multiforum Backend" \
  org.opencontainers.image.description="GraphQL and Neo4j backend for Multiforum" \
  org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production \
  PORT=4000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/ts_emitted ./ts_emitted

USER node

EXPOSE 4000

# A TCP check avoids coupling container health to GraphQL introspection or an
# authenticated application query while still proving the server is listening.
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=12 \
  CMD node -e "const socket=require('net').connect(process.env.PORT||4000,'127.0.0.1');socket.setTimeout(4000);socket.on('connect',()=>{socket.destroy();process.exit(0)});socket.on('timeout',()=>{socket.destroy();process.exit(1)});socket.on('error',()=>process.exit(1))"

CMD ["node", "./ts_emitted/index.js"]
