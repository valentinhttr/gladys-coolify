import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedCodes, applicationUrl, probe, Transitions } from '../src/health.js';
import { Monitor } from '../src/monitor.js';
import { normalizeConfig } from '../src/client.js';
import { externalId } from '../src/model.js';
import { CoolifyError } from '../src/i18n.js';
import { createFakeGladys } from './helpers/fake-gladys.js';

test('domain extraction respects Coolify container-port semantics and rejects credentials', () => {
  assert.equal(
    applicationUrl({ fqdn: 'https://app.example:3000/api,https://other.example' }),
    'https://app.example/api',
  );
  for (const fqdn of [
    '',
    'not-a-domain',
    'https://*.example',
    'https://user:secret@example.com',
    'https://example.com?token=secret',
    'ftp://example.com',
  ])
    assert.equal(applicationUrl({ fqdn }), null);
  assert.equal(acceptedCodes('200-399,401').has(401), true);
  for (const codes of ['', '600', '300-200', '200,secret'])
    assert.throws(() => acceptedCodes(codes));
});
test('HTTP checks are credential-free, do not follow redirects and cancel response bodies', async () => {
  let cancelled = false;
  const result = await probe('https://app.example', {
    now: (() => {
      let n = 0;
      return () => n++ * 42;
    })(),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://app.example');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.headers, { Accept: '*/*' });
      return {
        status: 302,
        body: {
          cancel: async () => {
            cancelled = true;
          },
        },
      };
    },
  });
  assert.deepEqual(result, { ok: true, code: 302, ms: 42 });
  assert.equal(cancelled, true);
  assert.equal(
    (
      await probe('https://app.example', {
        fetchImpl: async () => new Response('', { status: 503 }),
      })
    ).ok,
    false,
  );
  assert.deepEqual(
    await probe('https://app.example', {
      fetchImpl: async () => {
        throw new Error('secret');
      },
    }),
    { ok: false, code: null, ms: null },
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    await probe('https://app.example', {
      signal: abort.signal,
      fetchImpl: async () => {
        throw new Error('aborted');
      },
    }),
    null,
  );
});
test('transitions have a quiet baseline, require consecutive observations and ignore flapping', () => {
  const states = new Transitions();
  const observe = (value) => states.observe('app', value, 2);
  assert.deepEqual(
    [observe(true), observe(true), observe(false), observe(true)],
    [false, false, false, false],
  );
  assert.equal(observe(false), false);
  assert.equal(observe(null), false);
  assert.equal(observe(false), false);
  assert.equal(observe(false), true);
  assert.equal(observe(false), false);
  assert.equal(observe(true), false);
  assert.equal(observe(true), true);
});

async function fixture(ctx, overrides = {}, rawOverrides = {}) {
  const gladys = createFakeGladys();
  const raw = {
    url: 'https://coolify.example',
    api_token: 'secret',
    device_language: 'fr',
    http_mode: 'manual',
  };
  const resource = { uuid: 'a1', server: 's1', kind: 'application' };
  raw.http_resources = [externalId(gladys, normalizeConfig(raw), resource, 'resource').device];
  const state = {
    resource: 'running:healthy',
    server: true,
    http: true,
    failApi: false,
    failDomain: false,
    fqdn: 'https://app.example:3000/api',
    probes: 0,
    now: 1000000,
  };
  const monitor = new Monitor(gladys, {
    now: () => state.now,
    clientFactory: () => ({
      close() {},
      async get(path) {
        if (state.failApi) throw new CoolifyError('network');
        if (path === '/servers')
          return [{ uuid: 's1', name: 'Production', is_reachable: state.server, is_usable: true }];
        if (path === '/servers/s1/resources')
          return [
            { uuid: 'a1', name: 'API', type: 'application', status: state.resource },
            { uuid: 'a2', name: 'Other', type: 'application', status: 'running:healthy' },
          ];
        assert.equal(path, '/applications/a1');
        if (state.failDomain) throw new CoolifyError('forbidden');
        return { fqdn: state.fqdn, password: 'never-export' };
      },
    }),
    probeImpl: async (url, options) => {
      assert.equal(url, 'https://app.example/api');
      assert.ok(options.signal);
      state.probes++;
      return { ok: state.http, code: state.http ? 200 : 503, ms: 42 };
    },
    ...overrides,
  });
  ctx.after(() => monitor.stop());
  await monitor.configure({ ...raw, ...rawOverrides });
  await monitor.healthPending;
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[1]);
  async function tick() {
    state.now += 300000;
    await monitor.refresh();
    await monitor.healthPending;
  }
  return { gladys, monitor, state, raw, tick };
}
test('Coolify and HTTP alerts are independent, debounced and include safe notification variables', async (ctx) => {
  const { gladys, state, monitor, tick } = await fixture(ctx);
  await tick();
  assert.equal(gladys.fake.events.length, 0);
  state.http = false;
  await tick();
  assert.equal(gladys.fake.events.length, 0);
  await tick();
  assert.equal(gladys.fake.events[0].key, 'http_unavailable');
  await tick();
  assert.equal(gladys.fake.events.length, 1);
  state.resource = 'stopped';
  await tick();
  await tick();
  assert.equal(gladys.fake.events[1].key, 'resource_unavailable');
  assert.equal(gladys.fake.events[1].data.url, 'https://app.example/api');
  assert.equal(gladys.fake.events[1].data.device, gladys.fake.devices[0].external_id);
  assert.equal(gladys.fake.events[1].data.name, 'API');
  state.http = true;
  state.resource = 'running:healthy';
  state.server = false;
  await tick();
  await tick();
  assert.deepEqual(
    new Set(gladys.fake.events.slice(2).map((event) => event.key)),
    new Set(['http_recovered', 'resource_recovered', 'server_unavailable']),
  );
  assert.equal(monitor.health.size, 1);
  assert.ok(!JSON.stringify(gladys.fake.events).includes('never-export'));
  for (let i = 0; i < 65; i++) await tick();
  assert.ok(monitor.health.get('a1').samples.length > 60);
  assert.equal(gladys.fake.events.length, 5);
});
test('API and domain lookup errors are unknown observations, not application outages', async (ctx) => {
  const { gladys, state, monitor, tick } = await fixture(ctx);
  await tick();
  state.resource = 'stopped';
  await tick();
  state.failApi = true;
  await tick();
  assert.equal(gladys.fake.events.length, 0);
  state.failApi = false;
  await tick();
  assert.equal(gladys.fake.events.length, 0);
  await tick();
  assert.equal(gladys.fake.events[0].key, 'resource_unavailable');
  const length = monitor.health.get('a1').samples.length;
  state.failDomain = true;
  await tick();
  assert.equal(monitor.health.get('a1').error, 'domain');
  assert.equal(monitor.health.get('a1').samples.length, length);
  assert.equal(gladys.fake.events.length, 1);
  state.failDomain = false;
  state.fqdn = '';
  await tick();
  assert.equal(monitor.health.get('a1').error, 'no_domain');
  assert.equal(gladys.fake.events.length, 1);
});
test('HTTP monitoring is opt-in and a disabled selection removes previous statistics', async (ctx) => {
  const { monitor, raw, state, tick } = await fixture(ctx);
  const probes = state.probes;
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  await tick();
  assert.equal(monitor.health.size, 0);
  assert.equal(state.probes, probes);
});
test('configuration changes discard a late in-flight HTTP response', async (ctx) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const gladys = createFakeGladys();
  const raw = {
    url: 'https://coolify.example',
    api_token: 'secret',
    http_mode: 'manual',
    http_resources: [],
  };
  raw.http_resources = [
    externalId(gladys, normalizeConfig(raw), { uuid: 'a1', server: 's1' }, 'resource').device,
  ];
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const monitor = new Monitor(gladys, {
    clientFactory: () => ({
      close() {},
      async get(path) {
        if (path === '/servers') return [{ uuid: 's1' }];
        if (path === '/applications/a1') return { fqdn: 'https://app.example' };
        return [{ uuid: 'a1', type: 'application', status: 'running:healthy' }];
      },
    }),
    probeImpl: async () => {
      entered();
      await pending;
      return { ok: false, code: 503, ms: 42 };
    },
  });
  ctx.after(() => monitor.stop());
  await monitor.configure(raw);
  await started;
  const old = monitor.healthPending;
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  release();
  await old;
  assert.equal(monitor.health.size, 0);
  assert.equal(gladys.fake.events.length, 0);
});

test('first HTTP widget persists activation, starts a probe and survives configuration reload', async (ctx) => {
  const { monitor, raw, state, gladys } = await fixture(ctx, {}, { http_resources: [] });
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  const before = state.probes;
  const resource = monitor.snapshot.resources[0];
  const { renderWidget } = await import('../src/widgets.js');
  const settings = { resource: gladys.fake.devices[0].external_id };
  const content = await renderWidget('health', monitor, { settings });
  assert.match(JSON.stringify(content), /first HTTP check/);
  // Duplicate views share the activation and the samples.
  await renderWidget('health', monitor, { settings });
  await monitor.activationQueue;
  assert.equal(gladys.fake.configWrites.length, 1);
  assert.equal(state.probes, before + 1);
  assert.equal(monitor.health.get(resource.uuid).samples.length, 1);
  await renderWidget('health', monitor, { settings });
  await monitor.activationQueue;
  assert.equal(state.probes, before + 1);
  await monitor.configure({ ...raw, ...gladys.fake.config });
  await monitor.healthPending;
  assert.equal(monitor.health.get(resource.uuid).samples.length, 1);
});

test('activating another application keeps existing history and does not advance its alerts', async (ctx) => {
  const { monitor, gladys, state } = await fixture(ctx);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[2]);
  const get = monitor.client.get.bind(monitor.client);
  monitor.client.get = (path) => get(path === '/applications/a2' ? '/applications/a1' : path);
  const before = state.probes;
  const history = monitor.health.get('a1');
  const transitions = JSON.stringify([...monitor.transitions.entries]);
  monitor.ensureHttpMonitoring(monitor.snapshot.resources[1]);
  await monitor.activationQueue;
  assert.equal(state.probes, before + 1);
  assert.equal(monitor.health.get('a1'), history);
  assert.equal(monitor.health.get('a2').samples.length, 1);
  const oldTransitions = [...monitor.transitions.entries].filter(
    ([key]) => !(key.startsWith('http:') && key.endsWith('-a2')),
  );
  assert.equal(JSON.stringify(oldTransitions), transitions);
});

test('widget activation respects opt-out, capacity and failed saves', async (ctx) => {
  const { monitor, raw, gladys, state } = await fixture(ctx);
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  const { renderWidget } = await import('../src/widgets.js');
  const settings = { resource: gladys.fake.devices[0].external_id, auto_monitor: false };
  await renderWidget('health', monitor, { settings });
  await monitor.activationQueue;
  assert.equal(gladys.fake.configWrites.length, 0);
  const resource = monitor.snapshot.resources[0];
  monitor.config.httpResources = Array.from({ length: 20 }, (_, i) => `other-${i}`);
  monitor.ensureHttpMonitoring(resource);
  await monitor.activationQueue;
  assert.equal(monitor.ensureHttpMonitoring(resource), 'limit');
  assert.equal(gladys.fake.configWrites.length, 0);
  monitor.config.httpResources = [];
  state.now += 31000;
  gladys.setConfig = async () => {
    throw new Error('offline');
  };
  const before = state.probes;
  monitor.ensureHttpMonitoring(resource);
  await monitor.activationQueue;
  assert.equal(monitor.ensureHttpMonitoring(resource), 'save_error');
  assert.equal(state.probes, before);
  assert.deepEqual(monitor.config.httpResources, []);
});

test('simultaneous widget activations merge their saved applications', async (ctx) => {
  const { monitor, raw, gladys } = await fixture(ctx);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[2]);
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  const get = monitor.client.get.bind(monitor.client);
  monitor.client.get = (path) => get(path === '/applications/a2' ? '/applications/a1' : path);
  monitor.snapshot.resources.forEach((resource) => monitor.ensureHttpMonitoring(resource));
  await monitor.activationQueue;
  assert.equal(gladys.fake.configWrites.length, 2);
  assert.deepEqual(
    new Set(gladys.fake.config.http_resources),
    new Set(gladys.fake.devices.map((x) => x.external_id)),
  );
  assert.equal(monitor.health.size, 2);
});

test('queued widget activation is discarded after a configuration change', async (ctx) => {
  const { monitor, raw, gladys } = await fixture(ctx);
  await monitor.configure({ ...raw, http_resources: [] });
  await monitor.healthPending;
  let release;
  const getDevices = gladys.getDevices.bind(gladys);
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  gladys.getDevices = async () => {
    await waiting;
    return getDevices();
  };
  monitor.ensureHttpMonitoring(monitor.snapshot.resources[0]);
  await Promise.resolve();
  // configure invalidates the queued work synchronously, before its inventory completes.
  const configured = monitor.configure({ ...raw, http_resources: [] });
  release();
  await configured;
  await monitor.activationQueue;
  await monitor.healthPending;
  assert.equal(gladys.fake.configWrites.length, 0);
  assert.equal(monitor.health.size, 0);
});

test('HTTP checks are spaced by five minutes independently of inventory and widget refreshes', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  const { monitor, state, raw } = await fixture(ctx, {}, { poll_interval: 3600 });
  assert.equal(state.probes, 1);
  for (let i = 0; i < 4; i++) {
    state.now += 60000;
    await monitor.refresh();
    await monitor.healthPending;
  }
  assert.equal(state.probes, 1);
  const inventoryAt = monitor.snapshot.at;
  state.now += 60000;
  ctx.mock.timers.tick(300000);
  await monitor.healthPending;
  assert.equal(state.probes, 2);
  assert.equal(monitor.snapshot.at, inventoryAt);
  // A configuration reload restores history and does not probe twice in the same slot.
  await monitor.configure(raw);
  await monitor.healthPending;
  assert.equal(state.probes, 2);
  assert.equal(monitor.health.get('a1').samples.length, 2);
});

test('a fresh monitor restores disk history without another HTTP request or startup notification', async (ctx) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { HttpHistory } = await import('../src/history.js');
  const directory = await mkdtemp(join(tmpdir(), 'coolify-monitor-history-'));
  ctx.after(() => rm(directory, { recursive: true, force: true }));
  const first = await fixture(ctx, { history: new HttpHistory({ directory, now: () => 1000000 }) });
  first.monitor.stop();
  await first.monitor.history.flush();
  const second = await fixture(ctx, {
    history: new HttpHistory({ directory, now: () => 1000000 }),
  });
  assert.equal(second.state.probes, 0);
  assert.deepEqual(second.monitor.health.get('a1').samples, first.monitor.health.get('a1').samples);
  assert.equal(second.gladys.fake.events.length, 0);
});

test('automatic mode monitors all discovered applications without import, includes new apps and honors manual/off modes', async (ctx) => {
  const gladys = createFakeGladys();
  let now = 1000000;
  let healthy = true;
  let concurrent = 0;
  let peak = 0;
  const probes = [];
  const applications = Array.from({ length: 30 }, (_, i) => ({
    uuid: `app${i}`,
    name: `App ${i}`,
    type: 'application',
    status: 'running:healthy',
  }));
  const resources = [
    ...applications,
    { uuid: 'db', type: 'database', status: 'running' },
    { uuid: 'stack', type: 'service', status: 'running' },
  ];
  const monitor = new Monitor(gladys, {
    now: () => now,
    clientFactory: () => ({
      close() {},
      async get(path) {
        if (path === '/servers') return [{ uuid: 's1', is_reachable: true, is_usable: true }];
        if (path === '/servers/s1/resources') return resources;
        assert.match(path, /^\/applications\/app\d+$/);
        const id = path.split('/').at(-1);
        return { fqdn: id === 'app0' ? '' : `https://${id}.example` };
      },
    }),
    probeImpl: async (url) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setImmediate(resolve));
      concurrent--;
      probes.push(url);
      return { ok: healthy, code: healthy ? 200 : 503, ms: 50 };
    },
  });
  ctx.after(() => monitor.stop());
  // Existing selections do not silently put an upgraded installation into manual mode.
  const raw = {
    url: 'https://coolify.example',
    api_token: 'secret',
    http_resources: ['old-selection'],
  };
  await monitor.configure(raw);
  await monitor.healthPending;
  assert.equal(monitor.config.httpMode, 'all');
  assert.equal(gladys.fake.devices.length, 0);
  assert.equal(probes.length, 29);
  assert.ok(peak <= 4);
  assert.equal(monitor.health.get('app0').error, 'no_domain');
  assert.equal(gladys.fake.configWrites.length, 0);
  assert.equal(monitor.ensureHttpMonitoring(monitor.snapshot.resources[1]), 'active');
  resources.push({ uuid: 'app30', type: 'application', status: 'running:healthy' });
  await monitor.refresh();
  await monitor.healthPending;
  assert.equal(probes.length, 30);
  // More than twenty HTTP transitions remain available for scenes.
  for (let i = 0; i < 2; i++) {
    now += 300000;
    await monitor.refresh();
    await monitor.healthPending;
  }
  healthy = false;
  for (let i = 0; i < 2; i++) {
    now += 300000;
    await monitor.refresh();
    await monitor.healthPending;
  }
  assert.equal(gladys.fake.events.filter((event) => event.key === 'http_unavailable').length, 30);
  const before = probes.length;
  await monitor.configure({ ...raw, http_mode: 'off' });
  await monitor.healthPending;
  assert.equal(monitor.ensureHttpMonitoring(monitor.snapshot.resources[1]), 'off');
  assert.equal(monitor.health.size, 0);
  assert.equal(monitor.httpTimer, undefined);
  now += 300000;
  await monitor.refresh();
  await monitor.healthPending;
  assert.equal(probes.length, before);
  const selected = externalId(
    gladys,
    monitor.config,
    monitor.snapshot.resources[1],
    'resource',
  ).device;
  await monitor.configure({ ...raw, http_mode: 'manual', http_resources: [selected] });
  await monitor.healthPending;
  assert.equal(probes.length, before + 1);
  assert.equal(monitor.health.size, 1);
  assert.ok(monitor.health.get('app1').samples.length > 1);
});
