import { CoolifyError } from './i18n.js';
import { acceptedCodes } from './health.js';

export const bounded = (value, fallback, min, max) =>
  Math.min(
    max,
    Math.max(
      min,
      Math.floor(
        value === '' || value == null || !Number.isFinite(Number(value)) ? fallback : Number(value),
      ),
    ),
  );

export function normalizeConfig(raw = {}) {
  if (!raw.url || !raw.api_token) throw new CoolifyError('config');
  let url;
  try {
    url = new URL(String(raw.url).trim());
  } catch {
    throw new CoolifyError('url');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CoolifyError('url');
  const base = url.href.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const token = String(raw.api_token).trim();
  if (!token || /[\r\n]/.test(token)) throw new CoolifyError('config');
  return {
    url: base,
    token,
    interval: bounded(raw.poll_interval, 60, 30, 3600),
    language: raw.device_language === 'fr' ? 'fr' : 'en',
    confirmations: bounded(raw.alert_confirmations, 2, 1, 10),
    httpMode: ['manual', 'off'].includes(raw.http_mode) ? raw.http_mode : 'all',
    httpResources: Array.isArray(raw.http_resources) ? raw.http_resources.slice(0, 20) : [],
    httpTimeout: bounded(raw.http_timeout, 5, 1, 10),
    httpCodes: acceptedCodes(raw.http_codes),
  };
}

// Only explicit read endpoints are reachable. Never follow redirects with a bearer token.
export class CoolifyClient {
  constructor(config, { fetchImpl = fetch, now = Date.now } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
    this.retryAt = 0;
    this.abort = new AbortController();
  }
  close() {
    this.abort.abort();
    this.cache.clear();
  }
  async get(path, ttl = 0) {
    if (
      !/^\/(servers(?:\/[a-zA-Z0-9_-]+\/resources)?|applications\/[a-zA-Z0-9_-]+|deployments\/applications\/[a-zA-Z0-9_-]+\?skip=\d+&take=\d+)$/.test(
        path,
      )
    )
      throw new CoolifyError('response');
    const cached = this.cache.get(path);
    if (cached && cached.until > this.now()) return cached.value;
    if (this.pending.has(path)) return this.pending.get(path);
    if (this.retryAt > this.now()) throw new CoolifyError('rate');
    const request = this.request(path)
      .then((value) => {
        if (ttl > 0) {
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(path, { value, until: this.now() + ttl * 1000 });
        }
        return value;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, request);
    return request;
  }
  async request(path) {
    try {
      const response = await this.fetch(`${this.config.url}/api/v1${path}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.config.token}`, Accept: 'application/json' },
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]),
      });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(retry || '')
          ? Number(retry)
          : (Date.parse(retry) - this.now()) / 1000;
        this.retryAt = this.now() + bounded(seconds, 60, 1, 3600) * 1000;
        throw new CoolifyError('rate');
      }
      if (!response.ok)
        throw new CoolifyError(
          { 401: 'auth', 403: 'forbidden', 404: 'missing' }[response.status] || 'network',
        );
      // Cap memory even when Content-Length is absent or incorrect.
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new CoolifyError('response');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new CoolifyError('response');
      }
    } catch (error) {
      throw error instanceof CoolifyError ? error : new CoolifyError('network');
    }
  }
}
