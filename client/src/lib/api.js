export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', integration = null, env = [], details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.integration = integration;
    this.env = env;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, formData, signal } = {}) {
  const options = { method, headers: {}, signal };
  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(
      'Cannot reach the backend. Is the API server running on port 4000? (npm run dev)',
      { code: 'network_error' },
    );
  }

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const error = payload && typeof payload === 'object' ? payload.error : null;
    throw new ApiError(error?.message || `Request failed (HTTP ${response.status})`, {
      status: response.status,
      code: error?.code,
      integration: error?.integration,
      env: error?.env || [],
      details: error?.details,
    });
  }
  return payload;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', formData }),
};

export function downloadExport(format) {
  window.location.href = `/api/export/companies?format=${format}`;
}
