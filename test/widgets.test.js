import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { renderWidget, duration, WIDGET_KEYS } from '../src/widgets.js';
import { normalizeDeployment, status, serverStatus } from '../src/model.js';
import { CoolifyError } from '../src/i18n.js';
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
);
const server = { uuid: 's1', name: 'Production', reachable: true, usable: true };
const resource = {
  uuid: 'a1',
  server: 's1',
  serverName: 'Production',
  name: 'Website',
  kind: 'application',
  status: 'running:healthy',
};
const deployment = normalizeDeployment({
  deployment_uuid: 'd1',
  status: 'finished',
  created_at: '2026-10-10T10:00:00Z',
  started_at: '2026-10-10T10:00:10Z',
  finished_at: '2026-10-10T10:01:10Z',
  commit: '123456789abcdef',
  logs: 'secret',
});
function monitor(overrides = {}) {
  return {
    snapshot: {
      servers: [server],
      resources: Array.from({ length: 20 }, (_, i) => ({ ...resource, uuid: `a${i}` })),
      at: Date.parse('2026-10-10T10:01:10Z'),
    },
    resolve: (id, type) => (id === 'selected' ? (type === 'server' ? server : resource) : null),
    deployments: async () => [deployment],
    ensureHttpMonitoring: () => 'pending',
    now: () => overrides.health?.get('a1')?.at || Date.parse('2026-10-10T10:01:10Z'),
    ...overrides,
  };
}
test('manifest matches official Gladys schema and carries both languages', () => {
  const schema = JSON.parse(readFileSync(new URL('./manifest.schema.json', import.meta.url)));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  function translations(value) {
    if (!value || typeof value !== 'object') return;
    if ('en' in value) assert.equal(typeof value.fr, 'string');
    Object.values(value).forEach(translations);
  }
  translations(manifest);
  for (const widget of manifest.widgets) {
    assert.ok(widget.settings.length <= 10);
    assert.ok(WIDGET_KEYS.includes(widget.key));
  }
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    WIDGET_KEYS,
  );
  assert.equal(manifest.widgets.length, 4);
  assert.ok(!manifest.widgets[0].settings.find((field) => field.key === 'server').required);
});
for (const language of ['en', 'fr'])
  for (const key of WIDGET_KEYS)
    for (const layout of ['list', 'cards', 'grid'])
      test(`${key}: valid ${language} ${layout} within all SDK budgets`, async () => {
        const content = await renderWidget(key, monitor(), {
          language,
          settings: {
            server: 'selected',
            resource: 'selected',
            layout,
            limit: 1000,
            title: 'Very long title '.repeat(10),
          },
        });
        assert.deepEqual(validateWidgetContent(content), []);
      });
test('empty, missing selection, loading, errors and unknown states meet SDK contract', async () => {
  for (const model of [
    monitor({ snapshot: null }),
    monitor({ snapshot: null, error: new CoolifyError('auth') }),
    monitor({ error: new CoolifyError('network') }),
    monitor({ snapshot: { servers: [], resources: [], at: Date.now() } }),
    monitor({ deployments: async () => [] }),
    monitor({
      deployments: async () => {
        throw new CoolifyError('forbidden');
      },
    }),
  ]) {
    for (const key of WIDGET_KEYS)
      assert.deepEqual(
        validateWidgetContent(
          await renderWidget(key, model, {
            settings: { server: 'selected', resource: 'selected' },
          }),
        ),
        [],
      );
  }
  assert.equal(serverStatus({}).group, 'unknown');
  assert.equal(status('running:unhealthy').group, 'issues');
});
test('stale snapshots do not expose healthy status badges', async () => {
  const content = await renderWidget('overview', monitor({ error: new CoolifyError('network') }));
  assert.ok(!JSON.stringify(content).includes('"color":"success"'));
  assert.ok(JSON.stringify(content).includes('Last successful'));
});
test('resource selection determines its server, independently of old server settings', async () => {
  const mismatch = monitor({
    resolve: (_, type) => (type === 'server' ? { ...server, uuid: 'different' } : resource),
  });
  const content = await renderWidget('resource', mismatch, {
    settings: { server: 'selected', resource: 'selected' },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(JSON.stringify(content), /Production/);
  for (const key of ['resource', 'deployments'])
    assert.ok(
      !manifest.widgets
        .find((widget) => widget.key === key)
        .settings.some((field) => field.key === 'server'),
    );
  const db = monitor({
    resolve: (_, type) => (type === 'server' ? server : { ...resource, kind: 'database' }),
  });
  assert.match(
    JSON.stringify(await renderWidget('deployments', db, { settings: { resource: 'selected' } })),
    /not available for databases/,
  );
});
test('server filters reject resources with an explicit error, while valid lists retain colors', async () => {
  const model = monitor({ resolve: (_, type) => (type === 'resource' ? resource : null) });
  const error = await renderWidget('overview', model, { settings: { server: 'selected' } });
  assert.match(JSON.stringify(error), /Select a Server device/);
  const content = await renderWidget('overview', monitor(), {
    settings: { server: 'selected', limit: 12 },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Production');
  assert.ok(!content.components.some((component) => component.type === 'card-list'));
  const rows = content.components.find((component) => component.type === 'status').items;
  assert.equal(rows.length, 10);
  assert.equal(rows[0].color, 'success');
  assert.equal(rows[0].label, 'Website');
  assert.equal(rows[0].value.fr, 'En marche');
});
test('no inferred deployment timestamps, and only terminal deployments have duration', () => {
  assert.equal(normalizeDeployment({ updated_at: '2026-10-10T10:00:00Z' }).finished, undefined);
  assert.equal(duration(deployment), 70);
  assert.equal(duration({ ...deployment, finished: undefined }), null);
  assert.equal(duration({ ...deployment, finished: '2020-01-01T00:00:00Z' }), null);
  assert.ok(!JSON.stringify(deployment).includes('secret'));
});
test('each detail can be hidden and inventory filters combine', async () => {
  const hidden = await renderWidget('resource', monitor(), {
    settings: { resource: 'selected', fields: [], show_updated: false, show_refresh: false },
  });
  assert.equal(hidden.components.length, 1);
  const content = await renderWidget('overview', monitor(), {
    settings: { kinds: ['database'], show_counts: false },
  });
  assert.match(JSON.stringify(content), /No matching resource/);
});

test('successful deployments without completion timestamps show an unavailable date', async () => {
  const model = monitor({ deployments: async () => [{ ...deployment, finished: undefined }] });
  const content = await renderWidget('resource', model, { settings: { resource: 'selected' } });
  assert.deepEqual(validateWidgetContent(content), []);
  const serialized = JSON.stringify(content);
  assert.match(serialized, /Date unavailable/);
  assert.match(serialized, /123456789abc/);
  assert.ok(!serialized.includes('unreachable'));
});

test('deployment rows show dates and optional commit/duration with right-hand semantic results', async () => {
  const content = await renderWidget('deployments', monitor(), {
    settings: { resource: 'selected', fields: ['commit', 'duration'] },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(!content.components.some((component) => component.type === 'card-list'));
  const first = content.components.find((component) => component.type === 'status').items[0];
  assert.match(first.label, /10\/10\/26/);
  const detail = content.components.find((component) => component.type === 'status').items[1];
  assert.equal(detail.label, 'Commit 1234567');
  assert.equal(detail.value, '70 s');
  assert.equal(first.value.fr, 'Réussi');
  assert.equal(first.color, 'success');
  assert.ok(!first.label.includes('d1'));
});
test('HTTP statistics, chart and all error states stay within SDK budgets in both languages', async () => {
  const samples = [
    { at: Date.parse('2026-10-10T09:55Z'), ok: true, code: 200, ms: 100 },
    { at: Date.parse('2026-10-10T10:01Z'), ok: false, code: 503, ms: 200 },
  ];
  for (const language of ['en', 'fr'])
    for (const health of [
      { url: 'https://app.example', ...samples[1], samples },
      {
        url: 'https://app.example',
        ok: false,
        code: null,
        ms: null,
        at: samples[1].at,
        samples: [{ ...samples[1], ms: null }],
      },
      { error: 'domain' },
      { error: 'no_domain' },
      undefined,
    ]) {
      const content = await renderWidget('health', monitor({ health: new Map([['a1', health]]) }), {
        language,
        settings: { resource: 'selected' },
      });
      assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
      if (health?.samples?.length === 2) {
        assert.equal(content.components.find((component) => component.type === 'value').value, 50);
        assert.equal(
          content.components.find((component) => component.type === 'chart').series[0].points
            .length,
          2,
        );
      }
    }
});

test('deployment detail rows reserve space for footer metadata even with omitted limits', async () => {
  const content = await renderWidget(
    'deployments',
    monitor({ deployments: async () => Array.from({ length: 20 }, () => deployment) }),
    { settings: { resource: 'selected', fields: ['commit', 'duration'] } },
  );
  assert.deepEqual(validateWidgetContent(content), []);
  const rows = content.components.find((component) => component.type === 'status').items;
  assert.equal(rows.length, 10);
  assert.equal(rows[8].value, '1 · 4/20');
  assert.equal(rows[9].label.en, 'Checked');
});

test('HTTP charts mark failures, explain warmup and never turn timeouts into zero timings', async () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    at: 1000000 + i * 300000,
    ok: i === 0,
    code: i === 0 ? 200 : 503,
    ms: 40 + i,
  }));
  const render = (samples, settings = {}) =>
    renderWidget(
      'health',
      monitor({
        health: new Map([['a1', { url: 'https://app.example', ...samples.at(-1), samples }]]),
      }),
      { settings: { resource: 'selected', ...settings } },
    );
  let content = await render(samples);
  let chart = content.components.find((x) => x.type === 'chart');
  assert.equal(chart.chart_type, 'area');
  assert.equal(chart.unit, 'ms');
  assert.equal(chart.annotations.length, 8);
  assert.ok(chart.annotations.every((x) => x.color === 'danger' && x.label.en === '1 failed'));
  assert.deepEqual(validateWidgetContent(content), []);
  content = await render([samples[0]]);
  assert.match(JSON.stringify(content), /First response measured/);
  assert.deepEqual(validateWidgetContent(content), []);
  samples[10] = { ...samples[10], ms: null, code: null };
  content = await render(samples);
  chart = content.components.find((x) => x.type === 'chart');
  assert.equal(chart.chart_type, 'bar');
  assert.equal(chart.series[0].points.length, 19);
  assert.ok(chart.series[0].points.every((point) => point.v > 0));
  assert.deepEqual(validateWidgetContent(content), []);
});

test('overview switches from fleet readiness to the selected server and scopes its resource counts', async () => {
  const down = { ...server, reachable: false };
  const model = monitor({
    snapshot: {
      servers: [down, { ...server, uuid: 's2' }],
      resources: [resource, { ...resource, uuid: 'a2', server: 's2' }],
      at: 1000000,
    },
    resolve: (id, type) => (id === 'selected' && type === 'server' ? down : null),
  });
  const fleet = await renderWidget('overview', model);
  assert.equal(fleet.components[0].text, 'Coolify');
  assert.equal(fleet.components.find((x) => x.type === 'value').value, 2);
  assert.equal(
    fleet.components
      .find((x) => x.type === 'status')
      .items.find((x) => x.label.en === 'Servers ready').value,
    '1/2',
  );
  const single = await renderWidget('overview', model, { settings: { server: 'selected' } });
  assert.equal(single.components[0].text, 'Production');
  assert.equal(single.components.find((x) => x.type === 'value').value, 1);
  const rows = single.components.find((x) => x.type === 'status').items;
  assert.equal(rows.find((x) => x.label.en === 'Server').color, 'danger');
  assert.ok(!rows.some((x) => x.label.en === 'Servers ready'));
  assert.deepEqual(validateWidgetContent(single), []);
  assert.equal(
    (
      await renderWidget('overview', model, {
        settings: { server: 'selected', title: 'My server' },
      })
    ).components[0].text,
    'My server',
  );
});

test('month history renders all six period/style options within native budgets, with exact period statistics', async () => {
  const now = Date.parse('2026-10-10T12:00Z');
  const samples = Array.from({ length: 8640 }, (_, i) => ({
    at: now - (8639 - i) * 300000,
    ok: i % 17 !== 0,
    code: i % 17 === 0 ? 503 : 200,
    ms: 40 + (i % 100),
  }));
  const model = monitor({
    health: new Map([['a1', { url: 'https://app.example', ...samples.at(-1), samples }]]),
    now: () => now,
    history: { error: true },
  });
  for (const language of ['en', 'fr'])
    for (const style of ['area', 'line'])
      for (const [suffix, count, points] of [
        ['', 288, 288],
        ['_7d', 2016, 168],
        ['_30d', 8640, 240],
      ]) {
        const content = await renderWidget('health', model, {
          language,
          settings: { resource: 'selected', chart_type: style + suffix },
        });
        assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
        const chart = content.components.find((x) => x.type === 'chart');
        assert.equal(chart.series[0].points.length, points);
        assert.equal(chart.chart_type, style);
        const rows = content.components.find((x) => x.type === 'status').items;
        assert.equal(rows.find((x) => x.label.en === 'Checks').value, count);
        assert.equal(rows.find((x) => x.label.en === 'History storage').color, 'warning');
        const expected = samples.slice(-count).filter((x) => !x.ok).length;
        assert.equal(content.components.filter((x) => x.type === 'value')[2].value, expected);
      }
  const expired = await renderWidget(
    'health',
    { ...model, now: () => now + 31 * 86400000 },
    { settings: { resource: 'selected' } },
  );
  assert.deepEqual(validateWidgetContent(expired), []);
  assert.equal(expired.components.find((x) => x.type === 'value').value, '—');
  assert.match(JSON.stringify(expired), /Outdated/);
  const oneFailure = samples.map((sample, i) => ({ ...sample, ok: i !== 0 }));
  const precise = await renderWidget(
    'health',
    {
      ...model,
      health: new Map([
        ['a1', { url: 'https://app.example', ...oneFailure.at(-1), samples: oneFailure }],
      ]),
    },
    { settings: { resource: 'selected', chart_type: 'area_30d' } },
  );
  assert.equal(precise.components.find((x) => x.type === 'value').value, 99.99);
});
