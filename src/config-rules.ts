/** Shared syntax rules for runtime validation and the editor schema. */
// Enforce the absolute end; $ alone also matches before a final newline.
export const NAME = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?![\s\S])/;
export const INSTANCE = /^[a-z][a-z0-9_]*(?![\s\S])/;
export const RELATIVE_PATH = /^(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?![\s\S])/;
export const SCRIPT_NAME = /^[a-zA-Z0-9:_-]+(?![\s\S])/;
export const BASE_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*(?![\s\S])/;
export const NETWORK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?![\s\S])/;
export const ENV_NAME = /^(?!(?:SHIP_|NODE_|NPM_|PNPM_|LD_|DYLD_))(?!(?:PATH|HOME|ENV|BASH_ENV|SHELL|IFS|CI|COREPACK_HOME|HOST|HOSTNAME|PORT|NG_ALLOWED_HOSTS)$)[A-Z][A-Z0-9_]*(?![\s\S])/;
export const PUBLIC_PREFIX = /^(?:VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_|PUBLIC_|GATSBY_|REACT_APP_)/;
export const RESERVED = new Set(["init", "up", "down", "exec", "shell", "logs", "db", "config:test", "doctor", "build", "release", "npm", "pnpm", "yarn", "app"]);
