#!/bin/sh
set -eu
case "${SHIP_MONGO_MODE:-replica-set}" in
    replica-set)
        umask 077
        if [ ! -s /data/configdb/ship-key ]; then
            head -c 756 /dev/urandom | base64 | tr -d '\n' > /data/configdb/ship-key
        fi
        if [ "$(id -u)" = 0 ]; then chown mongodb:mongodb /data/configdb/ship-key; fi
        chmod 400 /data/configdb/ship-key
        # Detach under Docker's init so the bootstrap is reaped after completion.
        if [ "$(id -u)" = 0 ]; then (gosu mongodb ship-mongo-bootstrap &)
        else (ship-mongo-bootstrap &) fi
        exec /usr/local/bin/docker-entrypoint.sh mongod --bind_ip_all --auth --replSet rs0 --keyFile /data/configdb/ship-key
        ;;
    standalone)
        exec /usr/local/bin/docker-entrypoint.sh mongod --bind_ip_all --auth
        ;;
    *) echo 'ship: Invalid MongoDB mode.' >&2; exit 1 ;;
esac
