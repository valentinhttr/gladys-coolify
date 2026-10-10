import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoolifyClient, normalizeConfig } from '../src/client.js';
const config = normalizeConfig({ url: 'https://coolify.example/api/v1/', api_token: 'secret' });
test('normalizes the API suffix and validates URL and token', () => {
  assert.equal(config.url, 'https://coolify.example');
  for (const url of [
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com?key=secret',
    'https://example.com#x',
    'invalid',
  ])
    assert.throws(() => normalizeConfig({ url, api_token: 'secret' }));
  assert.throws(() => normalizeConfig({ url: 'https://example.com', api_token: '\r\n' }));
  assert.equal(
    normalizeConfig({ url: 'http://192.168.1.2:8000', api_token: 'a', poll_interval: 1 }).interval,
    30,
  );
});
test('GET-only, no redirects, bearer header, deduplicated requests and expiring cache', async () => {
  let count = 0;
  let now = 1000;
  const client = new CoolifyClient(config, {
    now: () => now,
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(url, 'https://coolify.example/api/v1/servers');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer secret');
      return Response.json([]);
    },
  });
  await Promise.all([client.get('/servers', 30), client.get('/servers', 30)]);
  await client.get('/servers', 30);
  assert.equal(count, 1);
  now += 31000;
  await client.get('/servers', 30);
  assert.equal(count, 2);
  for (const path of [
    '/deploy?uuid=abc',
    '//evil.com',
    '/servers/../envs',
    '/applications/x/start',
  ])
    await assert.rejects(client.get(path));
});
for (const [status, code] of [
  [401, 'auth'],
  [403, 'forbidden'],
  [404, 'missing'],
  [500, 'network'],
])
  test(`sanitizes HTTP ${status} without exposing server bodies`, async () => {
    const client = new CoolifyClient(config, {
      fetchImpl: async () => new Response('secret credentials', { status }),
    });
    await assert.rejects(
      client.get('/servers'),
      (error) => error.code === code && !error.message.includes('secret'),
    );
  });
test('respects Retry-After before allowing further requests', async () => {
  let now = 1000;
  let calls = 0;
  const client = new CoolifyClient(config, {
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '120' } })
        : Response.json([]);
    },
  });
  await assert.rejects(client.get('/servers'), { code: 'rate' });
  await assert.rejects(client.get('/servers'), { code: 'rate' });
  assert.equal(calls, 1);
  now += 121000;
  await client.get('/servers');
  assert.equal(calls, 2);
});
test('invalid JSON, oversized bodies and network failures are sanitized', async () => {
  for (const response of ['<html>login</html>', 'a'.repeat(4 * 1024 * 1024 + 1)]) {
    const client = new CoolifyClient(config, { fetchImpl: async () => new Response(response) });
    await assert.rejects(client.get('/servers'), { code: 'response' });
  }
  const client = new CoolifyClient(config, {
    fetchImpl: async () => {
      throw new Error('Bearer secret');
    },
  });
  await assert.rejects(
    client.get('/servers'),
    (error) => error.code === 'network' && !error.message.includes('secret'),
  );
});
