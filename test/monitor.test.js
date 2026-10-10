import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fake-gladys.js';
import { Monitor } from '../src/monitor.js';
import { devices, externalId, legacyExternalId } from '../src/model.js';
import { renderWidget } from '../src/widgets.js';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { CoolifyError } from '../src/i18n.js';
const config = { url: 'https://coolify.example', api_token: 'secret' };
const servers = [{ uuid: 's1', name: 'Production', is_reachable: true, is_usable: true }];
const resources = [
  {
    uuid: 'a1',
    name: 'Website',
    type: 'application',
    status: 'running:healthy',
    password: 'never-copy-me',
  },
];
const fixture = () => ({
  close() {},
  async get(path) {
    return path === '/servers' ? servers : resources;
  },
});
test('real installation selectors and Coolify UUIDs fit widget settings; old imported devices still update', async (ctx) => {
  for (const selector of ['ext-valentinhttr-gladys-coolify', 'ext-dev-coolify']) {
    const gladys = createFakeGladys(selector);
    const server = { ...servers[0], uuid: 's'.repeat(24) };
    const resource = { ...resources[0], uuid: 'a'.repeat(24) };
    const monitor = new Monitor(gladys, {
      clientFactory: () => ({
        close() {},
        async get(path) {
          if (path === '/servers') return [server];
          if (path.startsWith('/deployments/')) return { deployments: [] };
          return [resource];
        },
      }),
    });
    ctx.after(() => monitor.stop());
    await monitor.configure(config);
    const imported = gladys.fake.discoveredDevices[1];
    assert.ok(imported.external_id.length <= 100, imported.external_id);
    await gladys.fake.deviceCreated(imported);
    const normalized = monitor.snapshot.resources[0];
    const legacy = legacyExternalId(gladys, monitor.config, normalized, 'resource');
    if (legacy.device !== imported.external_id) {
      assert.ok(legacy.device.length > 100);
      await gladys.fake.deviceCreated({
        ...imported,
        external_id: legacy.device,
        features: [{ ...imported.features[0], external_id: legacy.feature('status') }],
      });
    }
    await monitor.publishStates();
    assert.equal(gladys.fake.states.length, gladys.fake.devices.length);
    assert.equal(monitor.resolve(legacy.device, 'resource'), normalized);
    assert.equal(monitor.resolve(imported.external_id, 'resource'), normalized);
    for (const key of ['resource', 'deployments']) {
      const content = await renderWidget(key, monitor, {
        settings: { resource: imported.external_id },
      });
      assert.deepEqual(validateWidgetContent(content), []);
      assert.equal(content.components[0].text, 'Website');
    }
    assert.notEqual(
      externalId(gladys, monitor.config, { ...normalized, server: 'other' }, 'resource').device,
      imported.external_id,
    );
    assert.notEqual(
      externalId(
        gladys,
        { ...monitor.config, url: 'https://other.example' },
        normalized,
        'resource',
      ).device,
      imported.external_id,
    );
  }
});
test('publishes valid SDK discovery, only imported device states and deduplicates changes', async (ctx) => {
  const gladys = createFakeGladys();
  const monitor = new Monitor(gladys, { clientFactory: fixture });
  ctx.after(() => monitor.stop());
  await monitor.configure(config);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(!JSON.stringify(monitor.snapshot).includes('never-copy-me'));
  for (const device of devices(gladys, monitor.config, monitor.snapshot))
    await gladys.fake.deviceCreated(device);
  await monitor.publishStates();
  assert.equal(gladys.fake.states.length, 2);
  await monitor.publishStates();
  assert.equal(gladys.fake.states.length, 2);
});
test('keeps last snapshot and marks it stale on failed inventory', async (ctx) => {
  let fail = false;
  const gladys = createFakeGladys();
  const monitor = new Monitor(gladys, {
    clientFactory: () => ({
      close() {},
      async get(path) {
        if (fail) throw new CoolifyError('auth');
        return path === '/servers' ? servers : resources;
      },
    }),
  });
  ctx.after(() => monitor.stop());
  await monitor.configure(config);
  const snapshot = monitor.snapshot;
  fail = true;
  await monitor.refresh();
  assert.equal(monitor.snapshot, snapshot);
  assert.equal(monitor.error.code, 'auth');
  assert.equal(gladys.fake.connectionStatus.connected, false);
});
test('config rotation discards an old in-flight response and clears old data', async (ctx) => {
  let release;
  let calls = 0;
  const delayed = new Promise((resolve) => (release = resolve));
  const gladys = createFakeGladys();
  const monitor = new Monitor(gladys, {
    clientFactory: () =>
      ++calls === 1
        ? {
            close() {},
            async get() {
              await delayed;
              return servers;
            },
          }
        : {
            close() {},
            async get() {
              return [];
            },
          },
  });
  ctx.after(() => monitor.stop());
  const old = monitor.configure(config);
  await monitor.configure({ ...config, url: 'https://new.example' });
  release();
  await old;
  assert.deepEqual(monitor.snapshot.servers, []);
  assert.equal(monitor.error, null);
  await monitor.configure({});
  assert.equal(monitor.snapshot, null);
  assert.equal(monitor.error.code, 'config');
});
test('malformed inventory fails closed', async (ctx) => {
  const gladys = createFakeGladys();
  const monitor = new Monitor(gladys, {
    clientFactory: () => ({
      close() {},
      async get() {
        return { unexpected: true };
      },
    }),
  });
  ctx.after(() => monitor.stop());
  await monitor.configure(config);
  assert.equal(monitor.snapshot, null);
  assert.equal(monitor.error.code, 'response');
});
