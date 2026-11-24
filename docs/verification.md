# Testing JavaScript Ship

Install dependencies with `npm ci` on a supported Node version. The Docker
and browser suites need Linux containers and Docker Compose. Test fixtures use
isolated Compose projects, temporary directories, and ephemeral ports.

| Command | What it checks |
| --- | --- |
| `npm run check` | Type checking and unit tests for configuration, the CLI, and release generation |
| `npm run check:spec -- ../com.ship.spec` | Shared schemas, service environment catalog, and release checker against the spec checkout |
| `npm run test:package` | Installation and operation of the packed npm artifact in a clean consumer |
| `npm run test:docker` | Real development stacks, framework builds, services, and portable releases |
| `npm run test:browser` | Chromium hot updates for Vite apps and navigation for Next.js static exports |
| `npm run test:transfer` | Booting the exported release without its application source directory |

Install Playwright Chromium before running the browser suite:

```sh
npx playwright install chromium
npm run test:browser
```

Use `SHIP_BROWSER_EXECUTABLE` to select an installed Chromium binary. Set
`SHIP_TEST_MUTAGEN=1` with Mutagen installed to run the optional sync test.

To run an individual Docker suite after building the CLI:

```sh
npm run build
node --test test/docker/workflow.test.mjs
```

The fixtures under `test/docker/` and `test/browser/` define the tested versions
and configurations. See [frameworks](frameworks.md) and [workspaces](workspaces.md)
for supported deployment modes. For a release candidate, run the quality, Docker,
and release-transfer workflows on the candidate commit.
