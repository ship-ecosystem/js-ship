import { test } from 'node:test';
import { exerciseFramework } from './framework-fixture.mjs';

for (const framework of ['expressjs', 'fastify', 'nestjs']) test(`${framework}: development and unprivileged production with real framework dependencies`, { timeout: 600_000 }, async t => {
  const marker = `Ship-${framework}-server`;
  let manifest, files;
  if (framework === 'nestjs') {
    manifest = { scripts: { 'start:dev': 'tsc && node --watch dist/main.js', build: 'tsc', 'start:prod': 'node dist/main.js' },
      dependencies: { '@nestjs/core': '12.5.1', '@nestjs/common': '12.5.1', '@nestjs/platform-express': '12.5.1', 'reflect-metadata': '0.2.2', rxjs: '7.8.2' },
      devDependencies: { typescript: '5.9.3', '@types/node': '22.20.5' } };
    files = { 'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', experimentalDecorators: true, emitDecoratorMetadata: true, skipLibCheck: true }, include: ['src'] }),
      'src/main.ts': `import 'reflect-metadata'; import {Controller,Get,Query,Module} from '@nestjs/common'; import {NestFactory} from '@nestjs/core';
@Controller() class AppController { @Get() home(){return '${marker}';} @Get('api/probe') probe(@Query('value') value:string){return {value,runtime:process.env.SHIP_FIXTURE_RUNTIME};} }
@Module({controllers:[AppController]}) class AppModule {}
const app=await NestFactory.create(AppModule); await app.listen(Number(process.env.PORT),'0.0.0.0');` };
  } else {
    manifest = { scripts: { dev: 'node --watch src/main.mjs', start: 'node src/main.mjs' }, dependencies: framework === 'expressjs' ? { express: '5.3.0' } : { fastify: '5.12.8' } };
    files = { 'src/main.mjs': framework === 'expressjs'
      ? `import express from 'express'; const app=express(); app.get('/',(_,res)=>res.send('${marker}')); app.get('/api/probe',(req,res)=>res.json({value:req.query.value,runtime:process.env.SHIP_FIXTURE_RUNTIME})); app.listen(Number(process.env.PORT),'0.0.0.0');`
      : `import Fastify from 'fastify'; const app=Fastify(); app.get('/',()=> '${marker}'); app.get('/api/probe',req=>({value:req.query.value,runtime:process.env.SHIP_FIXTURE_RUNTIME})); await app.listen({port:Number(process.env.PORT),host:'0.0.0.0'});` };
  }
  await exerciseFramework(t, { framework, marker, manifest, files, sources: ['src', 'dist', 'tsconfig.json'], probe: true, ...(framework === 'nestjs' ? { pruned: 'typescript' } : {}) });
});
