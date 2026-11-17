import { activeSearchProvider, search } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { IntegrationError } from '../lib/errors.js';

export function searchAvailability() {
  return {
    provider: activeSearchProvider(),
    configured: Boolean(activeSearchProvider()),
    requestQuotaHint: 'Each company usually costs 1 search request.',
  };
}

/**
 * Search the public web. Returns normalized results: [{ title, url, snippet }].
 */
export async function webSearch(query, { num = 8 } = {}) {
  const provider = activeSearchProvider();
  if (!provider) {
    throw new IntegrationError(
      'Web search is not configured. Add SERPAPI_KEY or GOOGLE_CSE_KEY + GOOGLE_CSE_CX to .env, or add companies with an explicit website.',
      { integration: 'search', env: ['SERPAPI_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'] },
    );
  }

  if (provider === 'serpapi') {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(num, 10)));
    url.searchParams.set('api_key', search.serpApiKey);
    const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
    return (json.organic_results || [])
      .map((item) => ({
        title: item.title || '',
        url: item.link || '',
        snippet: item.snippet || '',
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', search.googleApiKey);
  url.searchParams.set('cx', search.googleCx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(num, 10)));
  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  return (json.items || [])
    .map((item) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
    }))
    .filter((item) => /^https?:\/\//i.test(item.url));
}
