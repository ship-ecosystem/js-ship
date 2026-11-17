#!/bin/sh
set -eu
cd /app
@INSTALL@
exec node /usr/local/bin/ship-app-entrypoint.mjs "$@"
