import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
try {
  process.loadEnvFile(resolve(root, '.env.local'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const publicFiles = new Set([
  '/index.html', '/styles.css', '/app.js', '/model.js', '/map-geometry.js',
  '/map-objects.js', '/map-object-art.js',
  '/i18n.js', '/locales.js',
  '/svg/all.svg', '/svg/transport.svg', '/svg/ecology.svg',
  '/svg/social.svg', '/svg/security.svg', '/svg/services.svg',
  '/svg/district.svg', '/svg/city.svg'
]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4173);

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (!publicFiles.has(pathname)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const target = resolve(root, `.${pathname}`);
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': `${types[extname(target)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Демо: http://localhost:${port}`));
