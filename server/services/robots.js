import { fetchDocument } from '../lib/http.js';

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (field === 'user-agent') {
      if (current && current.agents.length && current.rules.length) {
        groups.push(current);
        current = null;
      }
      current ??= { agents: [], rules: [] };
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) continue;
      current.rules.push({ type: field, path: value });
    }
  }
  if (current && current.agents.length) groups.push(current);
  return groups;
}

function ruleMatches(rulePath, pathname) {
  if (rulePath === '') return false;
  if (rulePath === '/') return true;
  const pattern = rulePath
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\$$/, '$');
  return new RegExp(`^${pattern}`).test(pathname);
}

function isAllowedByRules(groups, userAgent, pathname) {
  const agentToken = userAgent.toLowerCase().split('/')[0];
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && agentToken.includes(agent)),
  );
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  const applicable = specific.length ? specific : wildcard;
  if (!applicable.length) return true;

  let best = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!ruleMatches(rule.path, pathname)) continue;
      const length = rule.path.replace(/\*/g, '').length;
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { type: rule.type, length };
      }
    }
  }
  return best ? best.type === 'allow' : true;
}

/** Check robots.txt for the given URL. Fails open only when robots.txt is missing. */
export async function isCrawlAllowed(url, userAgent) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const origin = target.origin;
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return isAllowedByRules(cached.groups, userAgent, target.pathname || '/');
  }

  try {
    const { text, status } = await fetchDocument(`${origin}/robots.txt`, {
      maxBytes: 200_000,
      timeoutMs: 8000,
    });
    if (status === 200) {
      const groups = parseRobots(text);
      cache.set(origin, { groups, at: Date.now() });
      return isAllowedByRules(groups, userAgent, target.pathname || '/');
    }
    cache.set(origin, { groups: [], at: Date.now() });
    return true;
  } catch {
    // Missing robots.txt (404) or network failure. Treat as allowed but do not cache hard failures.
    cache.set(origin, { groups: [], at: Date.now() });
    return true;
  }
}
