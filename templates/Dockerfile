# Published by ship init. Edited files are preserved unless --force is supplied.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
@PACKAGE_MANAGER_SETUP@
WORKDIR /app

FROM base AS dependencies
COPY package.json @LOCKFILE@ ./
RUN @INSTALL@

FROM dependencies AS builder
COPY . .
ARG SHIP_BUILD_SCRIPT=""
@BUILD_PREPARE@
RUN @BUILD@
@BUILDER_FINISH@

@PRODUCTION_STAGE@

FROM base AS development
ARG SHIP_UID=1000
ARG SHIP_GID=1000
RUN groupmod -o -g "$SHIP_GID" node && usermod -o -u "$SHIP_UID" -g "$SHIP_GID" node \
    && chown -R node:node /home/node /app
COPY --chmod=755 ship/dev-entrypoint.sh /usr/local/bin/ship-dev
COPY ship/app-entrypoint.mjs /usr/local/bin/ship-app-entrypoint.mjs
RUN mkdir -p /app/node_modules && chown node:node /app/node_modules
USER node
# Refresh the dependency volume on every start, including after branch switches.
ENTRYPOINT ["ship-dev"]
