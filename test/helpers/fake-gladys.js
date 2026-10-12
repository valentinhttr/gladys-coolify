// Keep the real SDK public methods covered by replacing only the HTTP transport,
// validating Coolify-specific payloads at that boundary instead of using /testing.
import { GladysIntegration } from '@gladysassistant/integration-sdk';
import assert from 'node:assert/strict';
export function createFakeGladys(selector = 'coolify') {
  const gladys = new GladysIntegration({
    hostApiUrl: 'http://localhost:1444',
    token: 'test-token',
    selector,
  });
  const fake = {
    devices: [],
    states: [],
    events: [],
    discoveredDevices: [],
    connectionStatus: null,
    config: {},
    configWrites: [],
    async deviceCreated(device) {
      fake.devices.push(device);
    },
  };
  gladys.fake = fake;
  gladys.httpClient = {
    async get(path) {
      assert.equal(path, '/device');
      return fake.devices;
    },
    async post(path, body) {
      if (path === '/discovered_device') {
        for (const device of body.devices) {
          assert.ok(device.external_id.startsWith(`ext:${selector}:`));
          assert.ok(device.name && device.name.length <= 100);
          for (const feature of device.features) {
            assert.equal(feature.category, 'text');
            assert.equal(feature.type, 'text');
            assert.equal(feature.read_only, true);
          }
        }
        fake.discoveredDevices = body.devices;
      } else if (path === '/state') {
        assert.ok(body.states.length <= 100);
        const known = new Set(
          fake.devices.flatMap((device) => device.features.map((feature) => feature.external_id)),
        );
        for (const state of body.states) {
          assert.ok(known.has(state.device_feature_external_id));
          assert.equal(typeof state.text, 'string');
        }
        fake.states.push(...body.states);
      } else if (path === '/config') {
        fake.configWrites.push(body.config);
        Object.assign(fake.config, body.config);
      } else if (path === '/scene/event') fake.events.push(body);
      else if (path === '/connection_status') fake.connectionStatus = body;
      else assert.fail(`Unexpected SDK request ${path}`);
      return {};
    },
  };
  return gladys;
}
