import { SERVICE_IMAGES } from "./service-images.js";
// Portable service definitions adapted from php-ship 0964965. No PHP is needed at runtime.
// Edit reviewed image tags, commands and probes here; release pins registry digests.
export const portableServiceData: Record<string, { label: string; group: string; dev: Record<string, Record<string, unknown>>; prod: Record<string, Record<string, unknown>> | unknown[]; env: Record<string, string>; http: { port: number; role: string; health?: string | null; urlSetting?: string | null }[]; shell: string[] | null }> = {
  "mysql": {
    "label": "MySQL",
    "group": "database",
    "dev": {
      "mysql-ship_placeholder": {
        "image": SERVICE_IMAGES.mysql,
        "environment": {
          "MYSQL_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "MYSQL_USER": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "MYSQL_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-secret}",
          "MYSQL_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:-rootsecret}"
        },
        "volumes": [
          "ship-mysql-ship_placeholder-data:/var/lib/mysql"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "mysqladmin",
            "ping",
            "-h",
            "127.0.0.1"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "mysql-ship_placeholder": {
        "image": SERVICE_IMAGES.mysql,
        "environment": {
          "MYSQL_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "MYSQL_USER": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "MYSQL_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:?set a real value in .env.production}",
          "MYSQL_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-mysql-ship_placeholder-data:/var/lib/mysql"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "mysqladmin",
            "ping",
            "-h",
            "127.0.0.1"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_DB_CONNECTION": "mysql",
      "SHIP_PLACEHOLDER_DB_HOST": "mysql-ship_placeholder",
      "SHIP_PLACEHOLDER_DB_PORT": "3306",
      "SHIP_PLACEHOLDER_DB_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
      "SHIP_PLACEHOLDER_DB_USERNAME": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
      "SHIP_PLACEHOLDER_DB_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-secret}"
    },
    "http": [],
    "shell": [
      "sh",
      "-c",
      "exec mysql -u\"$MYSQL_USER\" -p\"$MYSQL_PASSWORD\" \"$MYSQL_DATABASE\""
    ]
  },
  "mariadb": {
    "label": "MariaDB",
    "group": "database",
    "dev": {
      "mariadb-ship_placeholder": {
        "image": SERVICE_IMAGES.mariadb,
        "environment": {
          "MARIADB_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "MARIADB_USER": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "MARIADB_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-secret}",
          "MARIADB_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:-rootsecret}"
        },
        "volumes": [
          "ship-mariadb-ship_placeholder-data:/var/lib/mysql"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "healthcheck.sh",
            "--connect",
            "--innodb_initialized"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "mariadb-ship_placeholder": {
        "image": SERVICE_IMAGES.mariadb,
        "environment": {
          "MARIADB_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "MARIADB_USER": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "MARIADB_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:?set a real value in .env.production}",
          "MARIADB_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-mariadb-ship_placeholder-data:/var/lib/mysql"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "healthcheck.sh",
            "--connect",
            "--innodb_initialized"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_DB_CONNECTION": "mariadb",
      "SHIP_PLACEHOLDER_DB_HOST": "mariadb-ship_placeholder",
      "SHIP_PLACEHOLDER_DB_PORT": "3306",
      "SHIP_PLACEHOLDER_DB_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
      "SHIP_PLACEHOLDER_DB_USERNAME": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
      "SHIP_PLACEHOLDER_DB_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-secret}"
    },
    "http": [],
    "shell": [
      "sh",
      "-c",
      "exec mariadb -u\"$MARIADB_USER\" -p\"$MARIADB_PASSWORD\" \"$MARIADB_DATABASE\""
    ]
  },
  "sqlserver": {
    "label": "SQL Server",
    "group": "database",
    "dev": {
      "sqlserver-ship_placeholder": {
        "image": SERVICE_IMAGES.sqlserver,
        "platform": "linux/amd64",
        "entrypoint": [
          "/bin/bash",
          "-c",
          "case \"$$(printf '%s' \"$$SHIP_MSSQL_USERNAME\" | tr '[:upper:]' '[:lower:]')\" in\n  sa) echo 'ship: DB_USERNAME is \"sa\", SQL Server'\"'\"'s built-in admin login (its password is DB_ROOT_PASSWORD). Pick a different username.' >&2; exit 1 ;;\nesac\n/opt/mssql/bin/launch_sqlservr.sh /opt/mssql/bin/sqlservr &\npid=$$!\n# launch_sqlservr.sh doesn't forward signals to its sqlservr child, so the stop signal goes to\n# SQL Server itself (the oldest sqlservr, which coordinates shutdown), not to the wrapper.\ntrap 'pkill -TERM -o -x sqlservr' TERM INT\nsql() { /opt/mssql-tools18/bin/sqlcmd -C -b -x -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" \"$$@\"; }\nlit() { printf '%s' \"$$1\" | sed \"s/'/''/g\"; }\nuntil sql -l 2 -Q 'SELECT 1' >/dev/null 2>&1; do\n  kill -0 $$pid 2>/dev/null || { echo 'ship: SQL Server exited during startup; see the log above (a weak DB_ROOT_PASSWORD is the usual cause).' >&2; exit 1; }\n  sleep 1\ndone\nif ! sql -Q \"SET NOCOUNT ON;\n  DECLARE @db sysname = N'$$(lit \"$$SHIP_MSSQL_DATABASE\")', @user sysname = N'$$(lit \"$$SHIP_MSSQL_USERNAME\")',\n    @pw nvarchar(128) = N'$$(lit \"$$SHIP_MSSQL_PASSWORD\")', @sql nvarchar(max);\n  IF DB_ID(@db) IS NULL BEGIN SET @sql = N'CREATE DATABASE ' + QUOTENAME(@db); EXEC (@sql); END;\n  IF SUSER_ID(@user) IS NULL BEGIN\n    SET @sql = N'CREATE LOGIN ' + QUOTENAME(@user) + N' WITH PASSWORD = ' + QUOTENAME(@pw, '''') + N', DEFAULT_DATABASE = ' + QUOTENAME(@db);\n    EXEC (@sql);\n  END;\n  IF IS_SRVROLEMEMBER('sysadmin', @user) = 0 BEGIN\n    SET @sql = N'USE ' + QUOTENAME(@db) + N'; IF USER_ID(' + QUOTENAME(@user, '''') + N') IS NULL CREATE USER '\n      + QUOTENAME(@user) + N' FOR LOGIN ' + QUOTENAME(@user) + N'; ALTER ROLE db_owner ADD MEMBER ' + QUOTENAME(@user) + N';';\n    EXEC (@sql);\n  END;\"; then\n  echo 'ship: could not create the app database or login; see the error above (a DB_PASSWORD that fails the password policy is the usual cause).' >&2\n  pkill -TERM -o -x sqlservr; wait $$pid; exit 1\nfi\nwait $$pid; status=$$?\n# A trapped signal interrupts the first wait; the second lets SQL Server finish shutting down.\nif kill -0 $$pid 2>/dev/null; then wait $$pid; status=$$?; fi\nexit $$status"
        ],
        "stop_grace_period": "30s",
        "environment": {
          "ACCEPT_EULA": "Y",
          "MSSQL_PID": "Developer",
          "MSSQL_SA_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:-ShipRoot123}",
          "SHIP_MSSQL_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "SHIP_MSSQL_USERNAME": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "SHIP_MSSQL_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-ShipSecret123}"
        },
        "volumes": [
          "ship-sqlserver-ship_placeholder-data:/var/opt/mssql"
        ],
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "/opt/mssql-tools18/bin/sqlcmd -C -l 2 -S localhost -U \"$$SHIP_MSSQL_USERNAME\" -P \"$$SHIP_MSSQL_PASSWORD\" -d \"$$SHIP_MSSQL_DATABASE\" -Q \"SELECT 1\" >/dev/null"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 20,
          "start_period": "20s"
        }
      }
    },
    "prod": {
      "sqlserver-ship_placeholder": {
        "image": SERVICE_IMAGES.sqlserver,
        "platform": "linux/amd64",
        "entrypoint": [
          "/bin/bash",
          "-c",
          "case \"$$(printf '%s' \"$$SHIP_MSSQL_USERNAME\" | tr '[:upper:]' '[:lower:]')\" in\n  sa) echo 'ship: DB_USERNAME is \"sa\", SQL Server'\"'\"'s built-in admin login (its password is DB_ROOT_PASSWORD). Pick a different username.' >&2; exit 1 ;;\nesac\n/opt/mssql/bin/launch_sqlservr.sh /opt/mssql/bin/sqlservr &\npid=$$!\n# launch_sqlservr.sh doesn't forward signals to its sqlservr child, so the stop signal goes to\n# SQL Server itself (the oldest sqlservr, which coordinates shutdown), not to the wrapper.\ntrap 'pkill -TERM -o -x sqlservr' TERM INT\nsql() { /opt/mssql-tools18/bin/sqlcmd -C -b -x -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" \"$$@\"; }\nlit() { printf '%s' \"$$1\" | sed \"s/'/''/g\"; }\nuntil sql -l 2 -Q 'SELECT 1' >/dev/null 2>&1; do\n  kill -0 $$pid 2>/dev/null || { echo 'ship: SQL Server exited during startup; see the log above (a weak DB_ROOT_PASSWORD is the usual cause).' >&2; exit 1; }\n  sleep 1\ndone\nif ! sql -Q \"SET NOCOUNT ON;\n  DECLARE @db sysname = N'$$(lit \"$$SHIP_MSSQL_DATABASE\")', @user sysname = N'$$(lit \"$$SHIP_MSSQL_USERNAME\")',\n    @pw nvarchar(128) = N'$$(lit \"$$SHIP_MSSQL_PASSWORD\")', @sql nvarchar(max);\n  IF DB_ID(@db) IS NULL BEGIN SET @sql = N'CREATE DATABASE ' + QUOTENAME(@db); EXEC (@sql); END;\n  IF SUSER_ID(@user) IS NULL BEGIN\n    SET @sql = N'CREATE LOGIN ' + QUOTENAME(@user) + N' WITH PASSWORD = ' + QUOTENAME(@pw, '''') + N', DEFAULT_DATABASE = ' + QUOTENAME(@db);\n    EXEC (@sql);\n  END;\n  IF IS_SRVROLEMEMBER('sysadmin', @user) = 0 BEGIN\n    SET @sql = N'USE ' + QUOTENAME(@db) + N'; IF USER_ID(' + QUOTENAME(@user, '''') + N') IS NULL CREATE USER '\n      + QUOTENAME(@user) + N' FOR LOGIN ' + QUOTENAME(@user) + N'; ALTER ROLE db_owner ADD MEMBER ' + QUOTENAME(@user) + N';';\n    EXEC (@sql);\n  END;\"; then\n  echo 'ship: could not create the app database or login; see the error above (a DB_PASSWORD that fails the password policy is the usual cause).' >&2\n  pkill -TERM -o -x sqlservr; wait $$pid; exit 1\nfi\nwait $$pid; status=$$?\n# A trapped signal interrupts the first wait; the second lets SQL Server finish shutting down.\nif kill -0 $$pid 2>/dev/null; then wait $$pid; status=$$?; fi\nexit $$status"
        ],
        "stop_grace_period": "30s",
        "environment": {
          "ACCEPT_EULA": "Y",
          "MSSQL_PID": "${SHIP_PLACEHOLDER_MSSQL_PID:-Developer}",
          "MSSQL_SA_PASSWORD": "${SHIP_PLACEHOLDER_DB_ROOT_PASSWORD:?set a real value in .env.production}",
          "SHIP_MSSQL_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
          "SHIP_MSSQL_USERNAME": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
          "SHIP_MSSQL_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-sqlserver-ship_placeholder-data:/var/opt/mssql"
        ],
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "/opt/mssql-tools18/bin/sqlcmd -C -l 2 -S localhost -U \"$$SHIP_MSSQL_USERNAME\" -P \"$$SHIP_MSSQL_PASSWORD\" -d \"$$SHIP_MSSQL_DATABASE\" -Q \"SELECT 1\" >/dev/null"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 20,
          "start_period": "20s"
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_DB_CONNECTION": "sqlsrv",
      "SHIP_PLACEHOLDER_DB_HOST": "sqlserver-ship_placeholder",
      "SHIP_PLACEHOLDER_DB_PORT": "1433",
      "SHIP_PLACEHOLDER_DB_DATABASE": "${SHIP_PLACEHOLDER_DB_DATABASE:-app}",
      "SHIP_PLACEHOLDER_DB_USERNAME": "${SHIP_PLACEHOLDER_DB_USERNAME:-app}",
      "SHIP_PLACEHOLDER_DB_PASSWORD": "${SHIP_PLACEHOLDER_DB_PASSWORD:-ShipSecret123}",
      "SHIP_PLACEHOLDER_DB_URL": "sqlsrv://${SHIP_PLACEHOLDER_DB_USERNAME:-app}:${SHIP_PLACEHOLDER_DB_PASSWORD:-ShipSecret123}@sqlserver-ship_placeholder:1433/${SHIP_PLACEHOLDER_DB_DATABASE:-app}?trust_server_certificate=true"
    },
    "http": [],
    "shell": [
      "sh",
      "-c",
      "exec /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U \"$SHIP_MSSQL_USERNAME\" -P \"$SHIP_MSSQL_PASSWORD\" -d \"$SHIP_MSSQL_DATABASE\""
    ]
  },
  "valkey": {
    "label": "Valkey (Redis-compatible)",
    "group": "cache",
    "dev": {
      "valkey-ship_placeholder": {
        "image": SERVICE_IMAGES.valkey,
        "command": [
          "valkey-server",
          "--save",
          "60 1"
        ],
        "volumes": [
          "ship-valkey-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "valkey-cli",
            "ping"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "valkey-ship_placeholder": {
        "image": SERVICE_IMAGES.valkey,
        "command": [
          "valkey-server",
          "--save",
          "60 1"
        ],
        "volumes": [
          "ship-valkey-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "valkey-cli",
            "ping"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_REDIS_HOST": "valkey-ship_placeholder",
      "SHIP_PLACEHOLDER_REDIS_PORT": "6379"
    },
    "http": [],
    "shell": null
  },
  "memcached": {
    "label": "Memcached (cache only)",
    "group": "cache",
    "dev": {
      "memcached-ship_placeholder": {
        "image": SERVICE_IMAGES.memcached,
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "echo version | nc -w 2 127.0.0.1 11211 | grep -q \"^VERSION\""
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "memcached-ship_placeholder": {
        "image": SERVICE_IMAGES.memcached,
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "echo version | nc -w 2 127.0.0.1 11211 | grep -q \"^VERSION\""
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_MEMCACHED_HOST": "memcached-ship_placeholder",
      "SHIP_PLACEHOLDER_MEMCACHED_PORT": "11211"
    },
    "http": [],
    "shell": null
  },
  "seaweedfs": {
    "label": "SeaweedFS (S3-compatible storage)",
    "group": "storage",
    "dev": {
      "seaweedfs-ship_placeholder": {
        "image": SERVICE_IMAGES.seaweedfs,
        "entrypoint": [
          "/bin/sh",
          "-c"
        ],
        "command": [
          "mkdir -p /etc/seaweedfs && ACCESS_KEY_ESC=$$(printf '%s' \"$$AWS_ACCESS_KEY_ID\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g') && SECRET_KEY_ESC=$$(printf '%s' \"$$AWS_SECRET_ACCESS_KEY\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g') && printf '{\"identities\":[{\"name\":\"ship\",\"credentials\":[{\"accessKey\":\"%s\",\"secretKey\":\"%s\"}],\"actions\":[\"Admin\",\"Read\",\"Write\",\"List\",\"Tagging\"]}]}' \"$$ACCESS_KEY_ESC\" \"$$SECRET_KEY_ESC\" > /etc/seaweedfs/s3_identity.json && exec weed server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3_identity.json -dir=/data"
        ],
        "environment": {
          "AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}"
        },
        "volumes": [
          "ship-seaweedfs-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "wget",
            "-q",
            "-O",
            "-",
            "http://127.0.0.1:9333/cluster/status"
          ],
          "interval": "10s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "seaweedfs-ship_placeholder": {
        "image": SERVICE_IMAGES.seaweedfs,
        "entrypoint": [
          "/bin/sh",
          "-c"
        ],
        "command": [
          "mkdir -p /etc/seaweedfs && ACCESS_KEY_ESC=$$(printf '%s' \"$$AWS_ACCESS_KEY_ID\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g') && SECRET_KEY_ESC=$$(printf '%s' \"$$AWS_SECRET_ACCESS_KEY\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g') && printf '{\"identities\":[{\"name\":\"ship\",\"credentials\":[{\"accessKey\":\"%s\",\"secretKey\":\"%s\"}],\"actions\":[\"Admin\",\"Read\",\"Write\",\"List\",\"Tagging\"]}]}' \"$$ACCESS_KEY_ESC\" \"$$SECRET_KEY_ESC\" > /etc/seaweedfs/s3_identity.json && exec weed server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3_identity.json -dir=/data"
        ],
        "environment": {
          "AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-seaweedfs-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "wget",
            "-q",
            "-O",
            "-",
            "http://127.0.0.1:9333/cluster/status"
          ],
          "interval": "10s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_AWS_ENDPOINT": "http://seaweedfs-ship_placeholder:8333",
      "SHIP_PLACEHOLDER_AWS_USE_PATH_STYLE_ENDPOINT": "true",
      "SHIP_PLACEHOLDER_AWS_DEFAULT_REGION": "us-east-1",
      "SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
      "SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}",
      "SHIP_PLACEHOLDER_AWS_BUCKET": "${SHIP_PLACEHOLDER_AWS_BUCKET:-local}"
    },
    "http": [],
    "shell": null
  },
  "garage": {
    "label": "Garage (S3-compatible storage, lightweight alt.)",
    "group": "storage",
    "dev": {
      "garage-ship_placeholder": {
        "build": {
          "context": "./ship/garage",
          "dockerfile": "Dockerfile",
          "args": {
            "GARAGE_RPC_PUBLIC_ADDR": "garage-ship_placeholder:3901"
          }
        },
        "command": [
          "/garage",
          "server",
          "--single-node",
          "--default-access-key",
          "--default-bucket"
        ],
        "environment": {
          "GARAGE_DEFAULT_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-shipaccesskey}",
          "GARAGE_DEFAULT_SECRET_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecretplaceholder}",
          "GARAGE_DEFAULT_BUCKET": "${SHIP_PLACEHOLDER_AWS_BUCKET:-local}",
          "GARAGE_RPC_SECRET": "${SHIP_PLACEHOLDER_GARAGE_RPC_SECRET:-0000000000000000000000000000000000000000000000000000000000000000}",
          "GARAGE_ADMIN_TOKEN": "${SHIP_PLACEHOLDER_GARAGE_ADMIN_TOKEN:-shipsecret}"
        },
        "volumes": [
          "ship-garage-ship_placeholder-data:/data",
          "ship-garage-ship_placeholder-meta:/meta"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "/garage",
            "status"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "prod": {
      "garage-ship_placeholder": {
        "build": {
          "context": "./ship/garage",
          "dockerfile": "Dockerfile",
          "args": {
            "GARAGE_RPC_PUBLIC_ADDR": "garage-ship_placeholder:3901"
          }
        },
        "command": [
          "/garage",
          "server",
          "--single-node",
          "--default-access-key",
          "--default-bucket"
        ],
        "environment": {
          "GARAGE_DEFAULT_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-shipaccesskey}",
          "GARAGE_DEFAULT_SECRET_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:?set a real value in .env.production}",
          "GARAGE_DEFAULT_BUCKET": "${SHIP_PLACEHOLDER_AWS_BUCKET:-local}",
          "GARAGE_RPC_SECRET": "${SHIP_PLACEHOLDER_GARAGE_RPC_SECRET:?set a real value in .env.production}",
          "GARAGE_ADMIN_TOKEN": "${SHIP_PLACEHOLDER_GARAGE_ADMIN_TOKEN:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-garage-ship_placeholder-data:/data",
          "ship-garage-ship_placeholder-meta:/meta"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "/garage",
            "status"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_AWS_ENDPOINT": "http://garage-ship_placeholder:3900",
      "SHIP_PLACEHOLDER_AWS_USE_PATH_STYLE_ENDPOINT": "true",
      "SHIP_PLACEHOLDER_AWS_DEFAULT_REGION": "garage",
      "SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-shipaccesskey}",
      "SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecretplaceholder}",
      "SHIP_PLACEHOLDER_AWS_BUCKET": "${SHIP_PLACEHOLDER_AWS_BUCKET:-local}"
    },
    "http": [],
    "shell": null
  },
  "rustfs": {
    "label": "RustFS (S3-compatible storage, Rust)",
    "group": "storage",
    "dev": {
      "rustfs-ship_placeholder": {
        "image": SERVICE_IMAGES.rustfs,
        "environment": {
          "RUSTFS_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "RUSTFS_SECRET_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}"
        },
        "volumes": [
          "ship-rustfs-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "curl",
            "-f",
            "http://127.0.0.1:9000/health"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "prod": {
      "rustfs-ship_placeholder": {
        "image": SERVICE_IMAGES.rustfs,
        "environment": {
          "RUSTFS_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "RUSTFS_SECRET_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-rustfs-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "curl",
            "-f",
            "http://127.0.0.1:9000/health"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_AWS_ENDPOINT": "http://rustfs-ship_placeholder:9000",
      "SHIP_PLACEHOLDER_AWS_USE_PATH_STYLE_ENDPOINT": "true",
      "SHIP_PLACEHOLDER_AWS_DEFAULT_REGION": "us-east-1",
      "SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
      "SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}",
      "SHIP_PLACEHOLDER_AWS_BUCKET": "local"
    },
    "http": [],
    "shell": null
  },
  "silo": {
    "label": "Silo (S3-compatible storage, MinIO-compatible, with a web console)",
    "group": "storage",
    "dev": {
      "silo-ship_placeholder": {
        "image": SERVICE_IMAGES.silo,
        "command": [
          "server",
          "/data",
          "--console-address",
          ":9001"
        ],
        "environment": {
          "MINIO_ROOT_USER": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "MINIO_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}"
        },
        "ports": [
          "127.0.0.1:${SHIP_PLACEHOLDER_SILO_CONSOLE_PORT:-9001}:9001"
        ],
        "volumes": [
          "ship-silo-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "/usr/bin/silo",
            "healthcheck",
            "live"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "prod": {
      "silo-ship_placeholder": {
        "image": SERVICE_IMAGES.silo,
        "command": [
          "server",
          "/data",
          "--console-address",
          ":9001"
        ],
        "environment": {
          "MINIO_ROOT_USER": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
          "MINIO_ROOT_PASSWORD": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:?set a real value in .env.production}"
        },
        "ports": [
          "${SHIP_PLACEHOLDER_SILO_CONSOLE_PORT:-9001}:9001"
        ],
        "volumes": [
          "ship-silo-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "/usr/bin/silo",
            "healthcheck",
            "live"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 10,
          "start_period": "10s"
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_AWS_ENDPOINT": "http://silo-ship_placeholder:9000",
      "SHIP_PLACEHOLDER_AWS_USE_PATH_STYLE_ENDPOINT": "true",
      "SHIP_PLACEHOLDER_AWS_DEFAULT_REGION": "us-east-1",
      "SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID": "${SHIP_PLACEHOLDER_AWS_ACCESS_KEY_ID:-ship}",
      "SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY": "${SHIP_PLACEHOLDER_AWS_SECRET_ACCESS_KEY:-shipsecret}",
      "SHIP_PLACEHOLDER_AWS_BUCKET": "local"
    },
    "http": [],
    "shell": null
  },
  "meilisearch": {
    "label": "Meilisearch",
    "group": "search",
    "dev": {
      "meilisearch-ship_placeholder": {
        "image": SERVICE_IMAGES.meilisearch,
        "environment": {
          "MEILI_MASTER_KEY": "${SHIP_PLACEHOLDER_MEILISEARCH_KEY:-shipsearchkey}",
          "MEILI_NO_ANALYTICS": "true"
        },
        "volumes": [
          "ship-meilisearch-ship_placeholder-data:/meili_data"
        ]
      }
    },
    "prod": {
      "meilisearch-ship_placeholder": {
        "image": SERVICE_IMAGES.meilisearch,
        "environment": {
          "MEILI_MASTER_KEY": "${SHIP_PLACEHOLDER_MEILISEARCH_KEY:?set a real value in .env.production}",
          "MEILI_NO_ANALYTICS": "true"
        },
        "volumes": [
          "ship-meilisearch-ship_placeholder-data:/meili_data"
        ]
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_MEILISEARCH_HOST": "http://meilisearch-ship_placeholder:7700",
      "SHIP_PLACEHOLDER_MEILISEARCH_KEY": "${SHIP_PLACEHOLDER_MEILISEARCH_KEY:-shipsearchkey}"
    },
    "http": [],
    "shell": null
  },
  "elasticsearch": {
    "label": "Elasticsearch",
    "group": "search",
    "dev": {
      "elasticsearch-ship_placeholder": {
        "image": SERVICE_IMAGES.elasticsearch,
        "environment": {
          "discovery.type": "single-node",
          "xpack.security.enabled": "true",
          "xpack.security.http.ssl.enabled": "false",
          "xpack.security.transport.ssl.enabled": "false",
          "ELASTIC_PASSWORD": "${SHIP_PLACEHOLDER_ELASTICSEARCH_PASSWORD:-secret}",
          "ES_JAVA_OPTS": "-Xms1g -Xmx1g"
        },
        "volumes": [
          "ship-elasticsearch-ship_placeholder-data:/usr/share/elasticsearch/data"
        ],
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "curl -fsS -u \"elastic:$$ELASTIC_PASSWORD\" \"http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=5s\" >/dev/null"
          ],
          "interval": "10s",
          "timeout": "10s",
          "retries": 12,
          "start_period": "30s"
        }
      }
    },
    "prod": {
      "elasticsearch-ship_placeholder": {
        "image": SERVICE_IMAGES.elasticsearch,
        "environment": {
          "discovery.type": "single-node",
          "xpack.security.enabled": "true",
          "xpack.security.http.ssl.enabled": "false",
          "xpack.security.transport.ssl.enabled": "false",
          "ELASTIC_PASSWORD": "${SHIP_PLACEHOLDER_ELASTICSEARCH_PASSWORD:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-elasticsearch-ship_placeholder-data:/usr/share/elasticsearch/data"
        ],
        "healthcheck": {
          "test": [
            "CMD-SHELL",
            "curl -fsS -u \"elastic:$$ELASTIC_PASSWORD\" \"http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=5s\" >/dev/null"
          ],
          "interval": "10s",
          "timeout": "10s",
          "retries": 12,
          "start_period": "30s"
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_ELASTICSEARCH_HOST": "http://elasticsearch-ship_placeholder:9200",
      "SHIP_PLACEHOLDER_ELASTICSEARCH_USERNAME": "elastic",
      "SHIP_PLACEHOLDER_ELASTICSEARCH_PASSWORD": "${SHIP_PLACEHOLDER_ELASTICSEARCH_PASSWORD:-secret}"
    },
    "http": [],
    "shell": null
  },
  "typesense": {
    "label": "Typesense",
    "group": "search",
    "dev": {
      "typesense-ship_placeholder": {
        "image": SERVICE_IMAGES.typesense,
        "environment": {
          "TYPESENSE_API_KEY": "${SHIP_PLACEHOLDER_TYPESENSE_API_KEY:-shipsearchkey}",
          "TYPESENSE_DATA_DIR": "/data"
        },
        "volumes": [
          "ship-typesense-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "bash",
            "-c",
            "exec 3<>/dev/tcp/127.0.0.1/8108 && printf \"GET /health HTTP/1.0\\r\\n\\r\\n\" >&3 && grep -q '\"ok\":true' <&3"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 12
        }
      }
    },
    "prod": {
      "typesense-ship_placeholder": {
        "image": SERVICE_IMAGES.typesense,
        "environment": {
          "TYPESENSE_API_KEY": "${SHIP_PLACEHOLDER_TYPESENSE_API_KEY:?set a real value in .env.production}",
          "TYPESENSE_DATA_DIR": "/data"
        },
        "volumes": [
          "ship-typesense-ship_placeholder-data:/data"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "bash",
            "-c",
            "exec 3<>/dev/tcp/127.0.0.1/8108 && printf \"GET /health HTTP/1.0\\r\\n\\r\\n\" >&3 && grep -q '\"ok\":true' <&3"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 12
        }
      }
    },
    "env": {
      "SHIP_PLACEHOLDER_TYPESENSE_HOST": "typesense-ship_placeholder",
      "SHIP_PLACEHOLDER_TYPESENSE_PORT": "8108",
      "SHIP_PLACEHOLDER_TYPESENSE_PROTOCOL": "http",
      "SHIP_PLACEHOLDER_TYPESENSE_API_KEY": "${SHIP_PLACEHOLDER_TYPESENSE_API_KEY:-shipsearchkey}"
    },
    "http": [],
    "shell": null
  },
  "mailpit": {
    "label": "Mailpit (local mail capture)",
    "group": "mail",
    "dev": {
      "mailpit-ship_placeholder": {
        "image": SERVICE_IMAGES.mailpit,
        "ports": []
      }
    },
    "prod": [],
    "env": {
      "SHIP_PLACEHOLDER_MAIL_HOST": "mailpit-ship_placeholder",
      "SHIP_PLACEHOLDER_MAIL_PORT": "1025",
      "SHIP_PLACEHOLDER_MAIL_ENCRYPTION": "null"
    },
    "http": [],
    "shell": null
  },
  "playwright": {
    "label": "Playwright (browser server)",
    "group": "testing",
    "dev": {
      "playwright": {
        "image": SERVICE_IMAGES.playwright,
        "user": "pwuser",
        "working_dir": "/home/pwuser",
        "init": true,
        "shm_size": "2gb",
        "healthcheck": {
          "test": [
            "CMD",
            "node",
            "-e",
            "require('net').connect(3000, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 12,
          "start_period": "60s"
        },
        "command": [
          "npx",
          "-y",
          "playwright@1.65.1",
          "run-server",
          "--host",
          "0.0.0.0",
          "--port",
          "3000"
        ]
      }
    },
    "prod": [],
    "env": {
      "PW_TEST_CONNECT_WS_ENDPOINT": "ws://playwright:3000/"
    },
    "http": [],
    "shell": null
  },
  "cypress": {
    "label": "Cypress",
    "group": "testing",
    "dev": {
      "cypress": {
        "image": SERVICE_IMAGES.cypress,
        "entrypoint": [
          "sleep",
          "infinity"
        ],
        "init": true,
        "working_dir": "/e2e",
        "volumes": [
          ".:/e2e"
        ],
        "shm_size": "2gb"
      }
    },
    "prod": [],
    "env": {
      "CYPRESS_INSTALL_BINARY": "0"
    },
    "http": [],
    "shell": null
  },
  "centrifugo": {
    "label": "Centrifugo (WebSockets, any framework)",
    "group": "broadcasting",
    "dev": {
      "centrifugo": {
        "image": SERVICE_IMAGES.centrifugo,
        "environment": {
          "CENTRIFUGO_HTTP_API_KEY": "${CENTRIFUGO_API_KEY:-ship-centrifugo-api-key}",
          "CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY": "${CENTRIFUGO_TOKEN_SECRET:-ship-centrifugo-token-secret}",
          "CENTRIFUGO_CLIENT_ALLOWED_ORIGINS": "${CENTRIFUGO_ALLOWED_ORIGINS:-*}",
          "CENTRIFUGO_HEALTH_ENABLED": "true",
          "CENTRIFUGO_ENGINE_TYPE": "${CENTRIFUGO_ENGINE:-memory}",
          "CENTRIFUGO_ENGINE_REDIS_ADDRESS": "${CENTRIFUGO_REDIS_ADDRESS:-}",
          "CENTRIFUGO_ADMIN_ENABLED": "true",
          "CENTRIFUGO_ADMIN_PASSWORD": "${CENTRIFUGO_ADMIN_PASSWORD:-ship}",
          "CENTRIFUGO_ADMIN_SECRET": "ship-centrifugo-admin-secret"
        },
        "ports": [
          "127.0.0.1:${CENTRIFUGO_PORT:-8001}:8000"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "wget",
            "-qO-",
            "http://127.0.0.1:8000/health"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "prod": {
      "centrifugo": {
        "image": SERVICE_IMAGES.centrifugo,
        "environment": {
          "CENTRIFUGO_HTTP_API_KEY": "${CENTRIFUGO_API_KEY:?set a real value in .env.production}",
          "CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY": "${CENTRIFUGO_TOKEN_SECRET:?set a real value in .env.production}",
          "CENTRIFUGO_CLIENT_ALLOWED_ORIGINS": "${CENTRIFUGO_ALLOWED_ORIGINS:?set a real value in .env.production}",
          "CENTRIFUGO_HEALTH_ENABLED": "true",
          "CENTRIFUGO_ENGINE_TYPE": "${CENTRIFUGO_ENGINE:-memory}",
          "CENTRIFUGO_ENGINE_REDIS_ADDRESS": "${CENTRIFUGO_REDIS_ADDRESS:-}"
        },
        "ports": [
          "${CENTRIFUGO_PORT:-8001}:8000"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "wget",
            "-qO-",
            "http://127.0.0.1:8000/health"
          ],
          "interval": "5s",
          "timeout": "5s",
          "retries": 5
        }
      }
    },
    "env": {
      "CENTRIFUGO_URL": "http://centrifugo:8000",
      "CENTRIFUGO_API_KEY": "${CENTRIFUGO_API_KEY:-ship-centrifugo-api-key}",
      "CENTRIFUGO_TOKEN_SECRET": "${CENTRIFUGO_TOKEN_SECRET:-ship-centrifugo-token-secret}",
      "VITE_CENTRIFUGO_URL": "ws://localhost:${CENTRIFUGO_PORT:-8001}/connection/websocket"
    },
    "http": [
      {
        "port": 8000,
        "role": "websocket",
        "health": "/health",
        "urlSetting": "VITE_CENTRIFUGO_URL"
      }
    ],
    "shell": null
  },
  "rabbitmq": {
    "label": "RabbitMQ",
    "group": "broker",
    "dev": {
      "rabbitmq": {
        "image": SERVICE_IMAGES.rabbitmq,
        "hostname": "rabbitmq",
        "environment": {
          "RABBITMQ_DEFAULT_USER": "${RABBITMQ_USER:-app}",
          "RABBITMQ_DEFAULT_PASS": "${RABBITMQ_PASSWORD:-secret}"
        },
        "volumes": [
          "ship-rabbitmq-data:/var/lib/rabbitmq"
        ],
        "ports": [
          "127.0.0.1:${RABBITMQ_MANAGEMENT_PORT:-15672}:15672"
        ],
        "healthcheck": {
          "test": [
            "CMD",
            "rabbitmq-diagnostics",
            "-q",
            "ping"
          ],
          "interval": "10s",
          "timeout": "10s",
          "retries": 12,
          "start_period": "20s"
        }
      }
    },
    "prod": {
      "rabbitmq": {
        "image": SERVICE_IMAGES.rabbitmq,
        "hostname": "rabbitmq",
        "environment": {
          "RABBITMQ_DEFAULT_USER": "${RABBITMQ_USER:-app}",
          "RABBITMQ_DEFAULT_PASS": "${RABBITMQ_PASSWORD:?set a real value in .env.production}"
        },
        "volumes": [
          "ship-rabbitmq-data:/var/lib/rabbitmq"
        ],
        "ports": [],
        "healthcheck": {
          "test": [
            "CMD",
            "rabbitmq-diagnostics",
            "-q",
            "ping"
          ],
          "interval": "10s",
          "timeout": "10s",
          "retries": 12,
          "start_period": "20s"
        }
      }
    },
    "env": {
      "RABBITMQ_HOST": "rabbitmq",
      "RABBITMQ_PORT": "5672",
      "RABBITMQ_USER": "${RABBITMQ_USER:-app}",
      "RABBITMQ_PASSWORD": "${RABBITMQ_PASSWORD:-secret}",
      "RABBITMQ_VHOST": "/"
    },
    "http": [],
    "shell": null
  }
};
