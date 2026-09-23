import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname);
export const MAX_BODY_BYTES = 16 * 1024;
const publicFiles = new Set([
  '/index.html', '/styles.css', '/app.js', '/api.js', '/model.js', '/map-geometry.js',
  '/map-objects.js', '/map-object-art.js', '/i18n.js', '/locales.js',
  '/svg/all.svg', '/svg/transport.svg', '/svg/ecology.svg',
  '/svg/social.svg', '/svg/security.svg', '/svg/services.svg',
  '/svg/district.svg', '/svg/city.svg'
]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function apiError(res, status, code, message) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ errors: [{ code, message, path: '' }], score: null }));
}

function proxyApi(req, res, url, apiUrl, timeoutMs) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    req.resume();
    apiError(res, 413, 'BODY_TOO_LARGE', 'Тело запроса превышает 16 КиБ');
    return;
  }
  const target = new URL(apiUrl);
  target.pathname = url.pathname.startsWith('/api/health/') ? url.pathname.slice(4) : url.pathname;
  target.search = url.search;
  const headers = {};
  for (const name of ['accept', 'content-type', 'content-length']) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  let failed = false;
  let received = 0;
  const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers });
  const fail = (status, code, message) => {
    if (failed) return;
    failed = true;
    upstream.destroy();
    req.resume();
    apiError(res, status, code, message);
  };
  const timer = setTimeout(() => fail(504, 'API_TIMEOUT', 'Сервис не ответил вовремя'), timeoutMs);
  timer.unref();
  res.once('finish', () => clearTimeout(timer));
  res.once('close', () => {
    clearTimeout(timer);
    upstream.destroy();
  });
  upstream.on('error', () => fail(502, 'API_UNAVAILABLE', 'Сервис расчёта временно недоступен'));
  upstream.on('response', response => {
    if (failed || res.destroyed) {
      response.destroy();
      return;
    }
    const blocked = new Set(hopHeaders);
    for (const name of String(response.headers.connection || '').split(',')) blocked.add(name.trim().toLowerCase());
    const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !blocked.has(name)));
    res.writeHead(response.statusCode || 502, responseHeaders);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.on('drain', () => { if (!failed) req.resume(); });
  req.on('data', chunk => {
    if (failed) return;
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      fail(413, 'BODY_TOO_LARGE', 'Тело запроса превышает 16 КиБ');
      return;
    }
    if (!upstream.write(chunk)) req.pause();
  });
  req.on('end', () => { if (!failed) upstream.end(); });
  req.on('aborted', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
}

export function createUiServer({ apiUrl = 'http://127.0.0.1:8000', proxyTimeoutMs = 60_000 } = {}) {
  let upstream;
  try { upstream = new URL(apiUrl); } catch { throw new Error('API_URL must be an HTTP or HTTPS origin'); }
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) {
    throw new Error('API_URL must be an HTTP or HTTPS origin without credentials');
  }
  if (!Number.isFinite(proxyTimeoutMs) || proxyTimeoutMs <= 0) throw new Error('API_PROXY_TIMEOUT_SECONDS must be positive');
  return createServer(async (req, res) => {
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      proxyApi(req, res, url, upstream, proxyTimeoutMs);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    if (pathname === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'live' }));
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (!publicFiles.has(pathname)) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const data = await readFile(resolve(root, `.${pathname}`));
      res.writeHead(200, {
        'Content-Type': `${types[extname(pathname)] || 'application/octet-stream'}; charset=utf-8`,
        'Content-Length': data.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(resolve(root, '.env.local'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  createUiServer({
    apiUrl: process.env.API_URL || 'http://127.0.0.1:8000',
    proxyTimeoutMs: Number(process.env.API_PROXY_TIMEOUT_SECONDS || 60) * 1000
  }).listen(port, host, () => console.log(`UI: http://localhost:${port}`));
}
