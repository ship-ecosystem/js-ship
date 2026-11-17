FROM mongo:8.0
COPY --chmod=755 ship/mongodb/entrypoint.sh /usr/local/bin/ship-mongo
COPY --chmod=755 ship/mongodb/bootstrap.sh /usr/local/bin/ship-mongo-bootstrap
COPY ship/mongodb/bootstrap.js /usr/local/share/ship-mongo-bootstrap.js
COPY ship/mongodb/health.js /usr/local/share/ship-mongo-health.js
COPY ship/mongodb/app-user.js /docker-entrypoint-initdb.d/10-ship-user.js
ENTRYPOINT ["ship-mongo"]
