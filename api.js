import { MODEL_VERSION, toSelections } from './model.js';

export class ApiError extends Error {
  constructor(code, { status = 0, errors = [], cause } = {}) {
    super(errors[0]?.message || code, { cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

async function request(path, { body, signal, timeoutMs = 12000 } = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`/api/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
      cache: 'no-store'
    });
    let data;
    try { data = await response.json(); }
    catch (cause) { throw new ApiError(response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', { status: response.status, cause }); }
    if (!response.ok) {
      const errors = Array.isArray(data?.errors) ? data.errors : [];
      throw new ApiError(errors[0]?.code || 'HTTP_ERROR', { status: response.status, errors });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('INVALID_RESPONSE', { status: response.status });
    return data;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new ApiError('REQUEST_TIMEOUT', { cause: error });
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function scenarioBody(decisions) {
  if (!MODEL_VERSION) throw new ApiError('CATALOG_NOT_READY');
  return { model_version: MODEL_VERSION, selections: toSelections(decisions) };
}

export const getCatalog = (options = {}) => request('catalog', options);
export const validateScenario = (decisions, options = {}) => request('validate', { ...options, body: scenarioBody(decisions) });
export const evaluateScenario = (decisions, options = {}) => request('evaluate', { ...options, body: scenarioBody(decisions) });
export const explainScenario = (decisions, language, options = {}) => request('explain', { timeoutMs: 55000, ...options, body: { ...scenarioBody(decisions), language } });
