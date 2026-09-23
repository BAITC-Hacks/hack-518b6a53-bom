import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureCatalog } from './model.js';
import { ApiError, getCatalog, validateScenario, evaluateScenario, explainScenario } from './api.js';

const source = Object.fromEntries(await Promise.all(['districts', 'measures', 'rules', 'presets'].map(async name => [name, JSON.parse(await readFile(new URL(`../data/tech2-v1/${name}.json`, import.meta.url), 'utf8'))])));
const { model_version, ...rules } = source.rules;
const catalog = { model_version, rules, districts: source.districts.districts, measures: source.measures.measures, presets: source.presets.presets };
configureCatalog(catalog);

function mockFetch(t, implementation) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => { globalThis.fetch = original; });
}

test('catalog loads without a scenario body and goes through the same-origin API', async t => {
  mockFetch(t, async (url, options) => {
    assert.equal(url, '/api/v1/catalog');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.cache, 'no-store');
    return Response.json(catalog);
  });
  assert.deepEqual(await getCatalog(), catalog);
});

test('scenario requests use configured model version, API district IDs and omit city district_id', async t => {
  configureCatalog({ ...catalog, model_version: 'fixture-v2' });
  t.after(() => configureCatalog(catalog));
  const calls = [];
  mockFetch(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ valid_draft: false, can_evaluate: false, errors: [{ code: 'BUDGET_EXCEEDED', path: 'selections', message: 'Budget exceeded' }] });
  });
  const decisions = [{ id: 'M1', districtId: 'esil' }, { id: 'M2' }];
  const draft = await validateScenario(decisions);
  assert.equal(draft.valid_draft, false, 'successful draft validation with business errors is a normal result');
  await evaluateScenario(decisions);
  await explainScenario(decisions, 'kk');
  assert.deepEqual(calls.map(call => call.url), ['/api/v1/validate', '/api/v1/evaluate', '/api/v1/explain']);
  calls.forEach(({ options }, index) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), {
      model_version: 'fixture-v2', selections: [{ measure_id: 'M1', district_id: 'yesil' }, { measure_id: 'M2' }],
      ...(index === 2 ? { language: 'kk' } : {})
    });
  });
});

test('API errors preserve structured server codes, HTTP status and all validation paths', async t => {
  const errors = [
    { code: 'MODEL_VERSION_MISMATCH', message: 'Version changed', path: 'model_version' },
    { code: 'UNKNOWN_MEASURE', message: 'Unknown', path: 'selections[0].measure_id' }
  ];
  mockFetch(t, async () => Response.json({ errors, score: null }, { status: 409 }));
  await assert.rejects(evaluateScenario([]), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'MODEL_VERSION_MISMATCH');
    assert.equal(error.status, 409);
    assert.deepEqual(error.errors, errors);
    return true;
  });
});

test('network and malformed response errors remain distinguishable', async t => {
  mockFetch(t, async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(getCatalog(), { name: 'ApiError', code: 'NETWORK_ERROR' });
  globalThis.fetch = async () => new Response('<html>proxy unavailable</html>', { status: 502 });
  await assert.rejects(getCatalog(), { code: 'HTTP_ERROR', status: 502 });
  globalThis.fetch = async () => new Response('broken JSON');
  await assert.rejects(getCatalog(), { code: 'INVALID_RESPONSE', status: 200 });
  globalThis.fetch = async () => Response.json(null);
  await assert.rejects(getCatalog(), { code: 'INVALID_RESPONSE' });
});

test('timeout aborts a stalled request while user cancellation remains an AbortError', async t => {
  mockFetch(t, (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(getCatalog({ timeoutMs: 5 }), { code: 'REQUEST_TIMEOUT' });
  const controller = new AbortController();
  const pending = getCatalog({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(getCatalog({ signal: controller.signal }), { name: 'AbortError' });
});

test('explain carries all three languages and city or district scope without changing the scenario', async t => {
  const bodies = [];
  mockFetch(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return Response.json({ mode: 'llm', explanation: { summary: 'One paragraph.', strengths: [], risks: [], recommendations: [] }, language: body.language, district_id: body.district_id ?? null });
  });
  const scopes = [null, 'esil', 'almaty', 'saryarka', 'baikonur', 'nura'];
  for (const language of ['ru', 'kk', 'en']) {
    for (const districtId of scopes) {
      const result = await explainScenario([{ id: 'M12' }], language, { districtId });
      const apiDistrictId = districtId === 'esil' ? 'yesil' : districtId;
      assert.deepEqual(bodies.at(-1), {
        model_version, selections: [{ measure_id: 'M12' }], language,
        ...(districtId !== null ? { district_id: apiDistrictId } : {})
      });
      assert.equal(result.language, language);
      assert.equal(result.district_id, apiDistrictId);
      assert.equal(result.explanation.summary, 'One paragraph.');
    }
  }
  assert.equal(bodies.length, 18);
  await explainScenario([{ id: 'M12' }], 'ru');
  assert.equal(Object.hasOwn(bodies.at(-1), 'district_id'), false, 'omitted options default to city and omit district_id');
});

test('scoped explain preserves caller cancellation and request timeout options', async t => {
  mockFetch(t, (_url, { signal, body }) => new Promise((_resolve, reject) => {
    assert.equal(JSON.parse(body).district_id, 'yesil');
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(explainScenario([{ id: 'M12' }], 'kk', { districtId: 'esil', timeoutMs: 5 }), { code: 'REQUEST_TIMEOUT' });
  const controller = new AbortController();
  const pending = explainScenario([{ id: 'M12' }], 'en', { districtId: 'esil', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
