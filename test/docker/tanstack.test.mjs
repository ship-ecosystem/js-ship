import { test } from 'node:test';
import { exerciseFramework } from './framework-fixture.mjs';

test('TanStack Start: Nitro Node SSR, request-time routes and public/built assets without sources', { timeout: 900_000 }, async t => {
  await exerciseFramework(t, {
    framework: 'tanstack-start', marker: 'Ship-TanStack-SSR', asset: true, probe: true, scripts: true,
    manifest: { scripts: { dev: 'vite dev', build: 'vite build' },
      dependencies: { '@tanstack/react-start': '1.169.5', '@tanstack/react-router': '1.170.46', react: '19.3.1', 'react-dom': '19.3.1' },
      devDependencies: { nitro: '3.0.261103-rc', vite: '8.3.8', '@vitejs/plugin-react': '6.3.0' } },
    files: {
      'vite.config.js': "import {tanstackStart} from '@tanstack/react-start/plugin/vite'; import {nitro} from 'nitro/vite'; import react from '@vitejs/plugin-react'; export default {plugins:[tanstackStart(),nitro(),react()]};",
      'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', module: 'ESNext', target: 'ES2022', skipLibCheck: true, strictNullChecks: true } }),
      'src/router.tsx': "import {createRouter} from '@tanstack/react-router'; import {routeTree} from './routeTree.gen'; export function getRouter(){return createRouter({routeTree});}",
      'src/routes/__root.tsx': "import {createRootRoute,Outlet,HeadContent,Scripts} from '@tanstack/react-router'; export const Route=createRootRoute({component:()=> <html><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>});",
      'src/routes/index.tsx': "import {createFileRoute} from '@tanstack/react-router'; export const Route=createFileRoute('/')({component:()=> <h1>Ship-TanStack-SSR</h1>});",
      'src/routes/api.probe.ts': "import {createFileRoute} from '@tanstack/react-router'; export const Route=createFileRoute('/api/probe')({server:{handlers:{GET:({request})=>Response.json({value:new URL(request.url).searchParams.get('value'),runtime:process.env.SHIP_FIXTURE_RUNTIME})}}});",
      'public/fixture.txt': 'framework public asset',
    }, sources: ['src', 'public', 'vite.config.js', 'tsconfig.json'],
  });
});
