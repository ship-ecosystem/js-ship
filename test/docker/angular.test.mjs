import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get } from 'node:http';
import { exerciseFramework } from './framework-fixture.mjs';

for (const mode of ['node', 'static']) test(`Angular ${mode}: application builder, custom output paths, SSR/prerender and assets`, { timeout: 900_000 }, async t => {
  const marker = `Ship-Angular-${mode}`;
  const manifest = { scripts: { dev: 'ng serve', build: 'ng build' }, dependencies: {
    ...Object.fromEntries(['core','common','compiler','platform-browser','platform-server','router'].map(name=>[`@angular/${name}`, '22.2.6'])),
    '@angular/ssr': '22.2.7', express: '5.3.0', rxjs: '7.8.2', tslib: '2.8.1',
  }, devDependencies: { '@angular/cli': '22.2.7', '@angular/build': '22.2.7', '@angular/compiler-cli': '22.2.6', typescript: '6.0.3', '@types/node': '22.20.5', '@types/express': '5.0.6' } };
  const workspace = { version: 1, cli: { analytics: false }, projects: { frontend: { projectType: 'application', root: '', sourceRoot: 'src', architect: {
    build: { builder: '@angular/build:application', options: { outputPath: { base: 'dist/frontend', browser: 'client', server: 'node' }, browser: 'src/main.ts', index: 'src/index.html', tsConfig: 'tsconfig.json', server: 'src/main.server.ts', ssr: { entry: 'src/server.ts' }, outputMode: mode === 'node' ? 'server' : 'static', assets: [{ glob: '**/*', input: 'public' }] }, configurations: { production: { outputHashing: 'all' }, development: { optimization: false, sourceMap: true } }, defaultConfiguration: 'production' },
    serve: { builder: '@angular/build:dev-server', configurations: { development: { buildTarget: 'frontend:build:development' } }, defaultConfiguration: 'development' },
  } } } };
  await exerciseFramework(t, { framework: 'angular', mode, marker, manifest, asset: true, scripts: true, spa: mode === 'static', probe: mode === 'node', pruned: 'typescript', productionEnv: 'NG_ALLOWED_HOSTS=localhost,127.0.0.1\n',
    files: {
      'angular.json': JSON.stringify(workspace),
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', experimentalDecorators: true, skipLibCheck: true, esModuleInterop: true, lib: ['ES2022','DOM'], types: ['node'] }, angularCompilerOptions: { strictTemplates: true }, include: ['src/**/*.ts'] }),
      'src/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/"></head><body><app-root></app-root></body></html>',
      'src/app.ts': `import {Component,provideZonelessChangeDetection} from '@angular/core'; import {RouterOutlet,provideRouter} from '@angular/router'; @Component({selector:'app-page',standalone:true,template:'<h1>${marker}</h1>'}) export class Page {} @Component({selector:'app-root',standalone:true,imports:[RouterOutlet],template:'<router-outlet />'}) export class App {} export const config={providers:[provideZonelessChangeDetection(),provideRouter([{path:'',component:Page}])]};`,
      'src/main.ts': "import {bootstrapApplication} from '@angular/platform-browser'; import {App,config} from './app'; bootstrapApplication(App,config).catch(console.error);",
      'src/main.server.ts': `import {bootstrapApplication,BootstrapContext} from '@angular/platform-browser'; import {mergeApplicationConfig} from '@angular/core'; import {provideServerRendering,withRoutes,RenderMode} from '@angular/ssr'; import {App,config} from './app'; export default (context:BootstrapContext)=>bootstrapApplication(App,mergeApplicationConfig(config,{providers:[provideServerRendering(withRoutes([{path:'**',renderMode:RenderMode.${mode === 'node' ? 'Server' : 'Prerender'}}]))]}),context);`,
      'src/server.ts': `import express from 'express'; import {dirname,resolve} from 'node:path'; import {fileURLToPath} from 'node:url'; import {AngularNodeAppEngine,createNodeRequestHandler,isMainModule,writeResponseToNodeResponse} from '@angular/ssr/node'; const server=express(); const engine=new AngularNodeAppEngine(); server.get('/api/probe',(req,res)=>res.json({value:req.query.value,runtime:process.env.SHIP_FIXTURE_RUNTIME})); server.use(express.static(resolve(dirname(fileURLToPath(import.meta.url)),'../client'),{index:false,redirect:false})); server.use((req,res,next)=>{engine.handle(req).then(response=>response?writeResponseToNodeResponse(response,res):next()).catch(next);}); if(isMainModule(import.meta.url))server.listen(Number(process.env.PORT??4000),'0.0.0.0'); export const reqHandler=createNodeRequestHandler(server);`,
      'public/fixture.txt': 'framework public asset',
    }, sources: ['src', 'public', 'angular.json', 'tsconfig.json'],
    async afterProduction({base}) {
      if (mode === 'node') {
        // fetch rewrites Host to match its URL; use HTTP directly for this check.
        const status = await new Promise((resolve, reject) => {
          const request = get(base, { headers: { host: 'unexpected.invalid' }, timeout: 5000 }, response => { response.resume(); resolve(response.statusCode); });
          request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Host validation request timed out')));
        });
        assert.equal(status, 400, 'SSR still rejects unauthorized hosts');
      }
    },
  });
});
