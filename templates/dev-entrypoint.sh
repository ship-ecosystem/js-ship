#!/bin/sh
set -eu
if [ "${SHIP_WAIT_FOR_SYNC:-0}" = 1 ]; then
  echo 'ship: waiting for the initial Mutagen synchronization'
  while [ ! -f /tmp/ship-sync-ready ]; do sleep 1; done
fi
cd /app
@INSTALL@
@WORKSPACE_BUILD@
cd @APP_DIRECTORY@
exec node /usr/local/bin/ship-app-entrypoint.mjs "$@"
