import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ message: 'Hello from JavaScript Ship', environment: process.env.NODE_ENV }));
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
