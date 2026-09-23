import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createUiServer, MAX_BODY_BYTES } from './server.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('proxy forwards scenario bodies and streams responses before upstream completion', async t => {
  const payload = { model_version: 'tech2-v1', selections: [{ measure_id: 'M12' }] };
  let received;
  let finishResponse;
  const responseFinished = new Promise(resolve => { finishResponse = resolve; });
  const upstreamUrl = await listen(t, createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Model-Version': 'tech2-v1' });
    res.write('{"score":');
    await responseFinished;
    res.end('56.54}');
  }));
  const uiUrl = await listen(t, createUiServer({ apiUrl: upstreamUrl }));
  const response = await fetch(`${uiUrl}/api/v1/evaluate?language=ru`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-model-version'), 'tech2-v1');
  assert.deepEqual(received, { method: 'POST', url: '/api/v1/evaluate?language=ru', body: payload });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), '{"score":');
  finishResponse();
  let remainder = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remainder += new TextDecoder().decode(chunk.value);
  }
  assert.equal(remainder, '56.54}');
});

test('proxy preserves API errors and maps API health endpoints', async t => {
  const expected = { errors: [{ code: 'MODEL_VERSION_MISMATCH', message: 'Неизвестная версия модели', path: 'model_version' }], score: null };
  const upstreamUrl = await listen(t, createServer((req, res) => {
    req.resume();
    if (req.url === '/health/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ready"}');
    } else {
      res.writeHead(409, { 'Content-Type': 'application/json', 'Retry-After': '2' }).end(JSON.stringify(expected));
    }
  }));
  const uiUrl = await listen(t, createUiServer({ apiUrl: upstreamUrl }));
  const response = await fetch(`${uiUrl}/api/v1/evaluate`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('retry-after'), '2');
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(await (await fetch(`${uiUrl}/api/health/ready`)).json(), { status: 'ready' });
});

test('API unavailability is a safe 502 while static UI and health stay available', async t => {
  const unavailable = createServer();
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  const apiUrl = `http://127.0.0.1:${unavailable.address().port}`;
  await new Promise(resolve => unavailable.close(resolve));
  const uiUrl = await listen(t, createUiServer({ apiUrl }));
  const response = await fetch(`${uiUrl}/api/v1/catalog`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.errors[0].code, 'API_UNAVAILABLE');
  assert.ok(!JSON.stringify(body).includes(apiUrl));
  assert.equal((await fetch(`${uiUrl}/`)).status, 200);
  assert.deepEqual(await (await fetch(`${uiUrl}/health/live`)).json(), { status: 'live' });
  for (const path of ['/.env', '/.env.local', '/backend/settings.py', '/package.json', '/server.js']) {
    assert.equal((await fetch(`${uiUrl}${path}`)).status, 404);
  }
});

test('proxy rejects bodies larger than 16 KiB with and without Content-Length', async t => {
  const upstreamUrl = await listen(t, createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200).end('{}'));
  }));
  const uiUrl = await listen(t, createUiServer({ apiUrl: upstreamUrl }));
  const largeBody = 'x'.repeat(MAX_BODY_BYTES + 1);
  const response = await fetch(`${uiUrl}/api/v1/evaluate`, { method: 'POST', body: largeBody });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).errors[0].code, 'BODY_TOO_LARGE');
  const streamed = await new Promise((resolve, reject) => {
    const req = request(`${uiUrl}/api/v1/evaluate`, { method: 'POST' }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(largeBody);
    req.end();
  });
  assert.equal(streamed.status, 413);
  assert.equal(streamed.body.errors[0].code, 'BODY_TOO_LARGE');
});

test('proxy returns a 504 when upstream exceeds the configured timeout', async t => {
  const upstreamUrl = await listen(t, createServer(req => req.resume()));
  const uiUrl = await listen(t, createUiServer({ apiUrl: upstreamUrl, proxyTimeoutMs: 30 }));
  const response = await fetch(`${uiUrl}/api/v1/explain`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).errors[0].code, 'API_TIMEOUT');
});
