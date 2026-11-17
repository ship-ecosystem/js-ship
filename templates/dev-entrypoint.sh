#!/bin/sh
set -eu
cd /app
@INSTALL@
@WORKSPACE_BUILD@
cd @APP_DIRECTORY@
exec node /usr/local/bin/ship-app-entrypoint.mjs "$@"
