import { CoolifyError } from './i18n.js';

export function acceptedCodes(input = '200-399') {
  const codes = new Set();
  for (const part of String(input).split(',')) {
    const match = part.trim().match(/^([1-5]\d\d)(?:-([1-5]\d\d))?$/);
    if (!match || Number(match[2] || match[1]) < Number(match[1]))
      throw new CoolifyError('http_config');
    for (let code = Number(match[1]); code <= Number(match[2] || match[1]); code++) codes.add(code);
  }
  return codes;
}

export function applicationUrl(raw) {
  for (const candidate of String(raw?.fqdn || '').split(',')) {
    try {
      const url = new URL(candidate.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.hostname.includes('*')
      )
        continue;
      // In Coolify a domain's port targets the container, not the public proxy.
      url.port = '';
      if (url.href.length <= 1000) return url.href;
    } catch {
      /* An absent or non-HTTP domain is not a failed health check. */
    }
  }
  return null;
}

export async function probe(
  url,
  {
    signal,
    timeout = 5,
    codes = acceptedCodes(),
    fetchImpl = fetch,
    now = performance.now.bind(performance),
  } = {},
) {
  const started = now();
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      // This request deliberately has no Coolify token or application credentials.
      headers: { Accept: '*/*' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout * 1000)])
        : AbortSignal.timeout(timeout * 1000),
    });
    const ms = Math.max(0, Math.round(now() - started));
    await response.body?.cancel();
    return { ok: codes.has(response.status), code: response.status, ms };
  } catch {
    if (signal?.aborted) return null;
    return { ok: false, code: null, ms: null };
  }
}

// Debounce transitions, not repeated samples. An unknown reading breaks the
// consecutive sequence; the first confirmed state establishes a quiet baseline.
export class Transitions {
  constructor() {
    this.entries = new Map();
  }
  observe(key, state, confirmations) {
    if (state === null) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.candidate = null;
        entry.count = 0;
      }
      return false;
    }
    const entry = this.entries.get(key) || { stable: null, candidate: null, count: 0 };
    entry.count = entry.candidate === state ? entry.count + 1 : 1;
    entry.candidate = state;
    this.entries.set(key, entry);
    if (entry.count < confirmations || entry.stable === state) return false;
    const changed = entry.stable !== null;
    entry.stable = state;
    return changed;
  }
}
