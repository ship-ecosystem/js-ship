// Generated from images/Dockerfile by npm run build. Edit the catalog instead.
export const IMAGES = {
  "node22": "node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee",
  "node24": "node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54",
  "node26": "node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1",
  "nginx": "nginx:1.30.7-alpine@sha256:caf4e1e032a20f9c3c5e28fc7f25ffd768ad8677b4975c54193075997b3a97e3",
  "postgres": "postgres:18.7-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71",
  "redis": "redis:8.10.3-alpine3.23@sha256:7958cfbb9d152f87dadfbc89f1b0b15938f0b81ff8982feb327476f4911935c3",
  "mongo": "mongo:8.0.38@sha256:479e85ced54ffb8a40dade1dcde2da2a9ae858515b9415e9cc54bfb8f0575d01"
} as const;
export const NODE_MINIMUMS: Readonly<Record<string, string>> = {
  "22": "22.23.5",
  "24": "24.22.3",
  "26": "26.13.1"
};
