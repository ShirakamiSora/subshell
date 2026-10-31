import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'out/renderer';
const port = Number(process.argv[3] ?? 4399);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    const file = join(root, normalize(path).replace(/^([/\\])+/, ''));
    const data = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`preview server ready at http://127.0.0.1:${port}`);
});
