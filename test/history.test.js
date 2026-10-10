import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpHistory, historyKey, historyView, RETENTION, HTTP_INTERVAL } from '../src/history.js';
import { normalizeConfig } from '../src/client.js';
const key = 'a'.repeat(64);
const sample = (at, ok = true) => ({ at, ok, code: ok ? 200 : null, ms: ok ? 120 : null });
async function directory(ctx) {
  const path = await mkdtemp(join(tmpdir(), 'coolify-history-'));
  ctx.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('journal survives a new process, including failed checks, without storing domains or credentials', async (ctx) => {
  const path = await directory(ctx);
  let now = Date.parse('2026-10-10T12:00Z');
  const history = new HttpHistory({ directory: path, now: () => now });
  await history.record(key, sample(now));
  now += HTTP_INTERVAL;
  await history.record(key, sample(now, false));
  const restored = new HttpHistory({ directory: path, now: () => now });
  await restored.load();
  assert.deepEqual(restored.samples(key), [sample(now - HTTP_INTERVAL), sample(now, false)]);
  assert.equal(restored.error, false);
  assert.deepEqual(
    JSON.parse((await readFile(join(path, '2026-10-10.jsonl'), 'utf8')).trim().split('\n')[0]),
    [key, now - HTTP_INTERVAL, true, 200, 120],
  );
  await restored.record(key, sample(now, false));
  assert.equal(restored.samples(key).length, 2);
});

test('retention expires measurements and purges old daily journals', async (ctx) => {
  const path = await directory(ctx);
  let now = Date.parse('2026-10-10T12:00Z');
  await writeFile(
    join(path, '2026-09-09.jsonl'),
    JSON.stringify([key, now - RETENTION - 1, true, 200, 100]),
  );
  await writeFile(
    join(path, '2026-09-10.jsonl'),
    JSON.stringify([key, now - RETENTION, true, 200, 100]),
  );
  const history = new HttpHistory({ directory: path, now: () => now });
  await history.load();
  assert.deepEqual(history.samples(key), []);
  assert.ok(!(await readdir(path)).includes('2026-09-09.jsonl'));
  await history.record(key, sample(now));
  now += RETENTION + 24 * 60 * 60 * 1000;
  await history.record(key, sample(now));
  assert.equal(history.samples(key).length, 1);
  assert.ok(!(await readdir(path)).includes('2026-10-10.jsonl'));
});

test('a truncated record cannot swallow subsequent appends; corruption is reported', async (ctx) => {
  const path = await directory(ctx);
  const now = Date.parse('2026-10-10T12:00Z');
  await writeFile(join(path, '2026-10-10.jsonl'), '["unfinished');
  const history = new HttpHistory({ directory: path, now: () => now });
  await history.record(key, sample(now));
  const restored = new HttpHistory({ directory: path, now: () => now });
  await restored.load();
  assert.equal(restored.error, true);
  assert.deepEqual(restored.samples(key), [sample(now)]);
});

test('unwritable history reports failure while live monitoring can continue in memory', async (ctx) => {
  const path = join(await directory(ctx), 'not-a-directory');
  await writeFile(path, 'file');
  const now = Date.now();
  const history = new HttpHistory({ directory: path, now: () => now });
  await history.record(key, sample(now));
  assert.equal(history.error, true);
  assert.deepEqual(history.samples(key), [sample(now)]);
});

test('series remain isolated by instance, resource, domain and accepted codes, but survive token rotation', () => {
  const config = normalizeConfig({ url: 'https://coolify.example', api_token: 'one' });
  const resource = { server: 's1', uuid: 'a1' };
  const url = 'https://app.example/';
  const original = historyKey(config, resource, url);
  assert.equal(original, historyKey({ ...config, token: 'two' }, resource, url));
  for (const changed of [
    historyKey({ ...config, url: 'https://other.example' }, resource, url),
    historyKey(config, { ...resource, uuid: 'a2' }, url),
    historyKey(config, { ...resource, server: 's2' }, url),
    historyKey(config, resource, 'https://new.example/'),
    historyKey({ ...config, httpCodes: new Set([200]) }, resource, url),
  ])
    assert.notEqual(changed, original);
});

test('24 h, 7 d and 30 d keep exact raw counts while limiting chart buckets to 288, 168 and 240', () => {
  const now = Date.parse('2026-10-10T12:00Z');
  const samples = Array.from({ length: 31 * 288 }, (_, i) =>
    sample(now - (31 * 288 - 1 - i) * HTTP_INTERVAL, i % 11 !== 0),
  );
  for (const [selection, count, points] of [
    ['area', 288, 288],
    ['area_7d', 2016, 168],
    ['area_30d', 8640, 240],
  ]) {
    const view = historyView(samples, selection, now);
    assert.equal(view.samples.length, count);
    assert.equal(view.buckets.length, points);
    assert.equal(
      view.buckets.reduce((sum, b) => sum + b.total, 0),
      count,
    );
    assert.equal(
      view.buckets.reduce((sum, b) => sum + b.failures, 0),
      view.samples.filter((x) => !x.ok).length,
    );
    assert.equal(view.gaps, true);
  }
  const sparse = historyView([sample(now - 3 * HTTP_INTERVAL), sample(now)], 'area', now);
  assert.equal(sparse.gaps, true);
  assert.equal(sparse.samples.length, 2);
  assert.equal(sparse.buckets.length, 2);
});

test('automatic-mode journals larger than 4 MiB are streamed without discarding measurements', async (ctx) => {
  const path = await directory(ctx);
  const now = Date.parse('2026-10-10T23:00Z');
  const lines = Array.from({ length: 50000 }, (_, i) =>
    JSON.stringify([key, now - (49999 - i) * 1000, true, 200, 120]),
  ).join('\n');
  assert.ok(Buffer.byteLength(lines) > 4 * 1024 * 1024);
  await writeFile(join(path, '2026-10-10.jsonl'), lines);
  const restored = new HttpHistory({ directory: path, now: () => now });
  await restored.load();
  assert.equal(restored.error, false);
  assert.equal(restored.samples(key).length, 50000);
});
