# syntax=docker/dockerfile:1
# Published by ship init. Edited files are preserved unless --force is supplied.
ARG NODE_IMAGE=@NODE_IMAGE@
FROM ${NODE_IMAGE} AS base
COPY ship/runtime-version.mjs ship/check-runtime.mjs /usr/local/lib/ship/
RUN node /usr/local/lib/ship/check-runtime.mjs
@PACKAGE_MANAGER_SETUP@
WORKDIR /app

FROM base AS dependencies
@DEPENDENCY_COPY@
RUN @INSTALL@

FROM dependencies AS builder
COPY . .
ARG SHIP_BUILD_SCRIPT=""
@PUBLIC_BUILD_ARGS@
@BUILD_PREPARE@
RUN @BUILD_SECRET_MOUNTS@@BUILD@
@BUILDER_FINISH@

@PRODUCTION_STAGE@

FROM base AS development
ARG SHIP_UID=1000
ARG SHIP_GID=1000
RUN groupmod -o -g "$SHIP_GID" node && usermod -o -u "$SHIP_UID" -g "$SHIP_GID" node \
    && chown -R node:node /home/node /app
COPY --chmod=755 ship/dev-entrypoint.sh /usr/local/bin/ship-dev
COPY ship/app-entrypoint.mjs /usr/local/bin/ship-app-entrypoint.mjs
RUN mkdir -p @DEVELOPMENT_DEPENDENCY_DIRS@ && chown -R node:node /app
USER node
# Refresh the dependency volume on every start, including after branch switches.
ENTRYPOINT ["ship-dev"]
