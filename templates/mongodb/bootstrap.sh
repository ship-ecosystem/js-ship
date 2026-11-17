#!/bin/sh
set -eu
attempt=0
while [ "$attempt" -lt 120 ]; do
    if mongosh --nodb --quiet /usr/local/share/ship-mongo-bootstrap.js >/dev/null 2>&1; then exit 0; fi
    attempt=$((attempt + 1))
    sleep 1
done
echo 'ship: MongoDB replica-set bootstrap did not complete. Check credentials, mode and existing replica-set configuration.' >&2
exit 1
