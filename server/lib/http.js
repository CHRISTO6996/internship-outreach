import { crawl } from '../config.js';

export class HttpError extends Error {
  constructor(message, { status = null, url = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const MAX_JSON_BYTES = 4_000_000;

async function request(url, { timeoutMs = crawl.requestTimeoutMs, headers = {}, method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': crawl.userAgent,
        accept: '*/*',
        ...headers,
      },
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new HttpError(`Request timed out after ${timeoutMs}ms`, { url });
    }
    throw new HttpError(`Request failed: ${error.message}`, { url });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch an HTML/text document with a hard byte cap. */
export async function fetchDocument(url, { maxBytes = crawl.maxPageBytes, timeoutMs, headers } = {}) {
  const response = await request(url, { timeoutMs, headers });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? ' — the site blocked automated access'
        : response.status === 429
          ? ' — rate limited by the site'
          : '';
    throw new HttpError(`HTTP ${response.status}${hint}`, { status: response.status, url: response.url || url });
  }
  const contentType = response.headers.get('content-type') || '';
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes * 4) {
    throw new HttpError(`Document too large (${declared} bytes)`, { url: response.url || url });
  }

  const reader = response.body?.getReader();
  const chunks = [];
  let received = 0;
  if (reader) {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    url: response.url || url,
    status: response.status,
    contentType,
    text: buffer.toString('utf8'),
    truncated: received >= maxBytes,
  };
}

export async function fetchJson(url, { timeoutMs, headers } = {}) {
  const response = await request(url, {
    timeoutMs,
    headers: { accept: 'application/json', ...headers },
  });
  const raw = await response.text();
  if (raw.length > MAX_JSON_BYTES) {
    throw new HttpError('JSON response too large', { status: response.status, url });
  }
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new HttpError('Response was not valid JSON', { status: response.status, url });
  }
  if (!response.ok) {
    const detail = json?.error?.message || json?.message || json?.error || `HTTP ${response.status}`;
    throw new HttpError(typeof detail === 'string' ? detail : JSON.stringify(detail), {
      status: response.status,
      url,
    });
  }
  return json;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
