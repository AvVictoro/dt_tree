import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleCatalogRequest } from '../server/catalog-service.mjs';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/catalog')) {
    let body = null;
    if (request.method === 'POST') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    }
    const result = await handleCatalogRequest({ method: request.method, pathname, searchParams: url.searchParams, body });
    response.writeHead(result.status, result.headers).end(JSON.stringify(result.payload));
    return;
  }
  const relative = pathname === '/' ? '/datatracker-agent-v6.html' : pathname;
  const file = path.resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': stats.size
    });
    fs.createReadStream(file).pipe(response);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`DataTracker: http://127.0.0.1:${port}/`);
});
