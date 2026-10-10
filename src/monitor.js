import { CoolifyClient, normalizeConfig } from './client.js';
import {
  array,
  normalizeServer,
  normalizeResource,
  normalizeDeployment,
  devices,
  externalId,
  legacyExternalId,
  serverStatus,
  status,
} from './model.js';
import { CoolifyError, errorMessage, localize } from './i18n.js';
import { applicationUrl, probe, Transitions } from './health.js';
import { HttpHistory, historyKey, HTTP_INTERVAL } from './history.js';
import { createLogger } from '@gladysassistant/integration-sdk';
const logger = createLogger({ name: 'coolify-monitoring' });

async function mapLimit(values, task) {
  let index = 0;
  const result = new Array(values.length);
  await Promise.all(
    Array.from({ length: Math.min(4, values.length) }, async () => {
      while (index < values.length) {
        const i = index++;
        result[i] = await task(values[i]);
      }
    }),
  );
  return result;
}

export class Monitor {
  constructor(
    gladys,
    {
      clientFactory = (config) => new CoolifyClient(config),
      now = Date.now,
      probeImpl = probe,
      history = new HttpHistory({ now }),
    } = {},
  ) {
    this.gladys = gladys;
    this.clientFactory = clientFactory;
    this.now = now;
    this.probe = probeImpl;
    this.history = history;
    this.nextHttp = new Map();
    this.generation = 0;
    this.snapshot = null;
    this.error = null;
    this.sent = new Map();
    this.transitions = new Transitions();
    this.health = new Map();
    this.httpActivation = new Map();
    this.activationQueue = Promise.resolve();
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.httpTimer);
    this.httpTimer = undefined;
    this.client?.close();
    this.client = null;
    this.pending = null;
    this.healthAbort?.abort();
    this.healthPending = null;
  }
  async configure(raw) {
    this.stop();
    this.snapshot = null;
    this.sent.clear();
    this.transitions = new Transitions();
    this.health.clear();
    this.nextHttp.clear();
    this.httpActivation.clear();
    this.healthAbort = new AbortController();
    this.error = null;
    try {
      this.config = normalizeConfig(raw);
      this.client = this.clientFactory(this.config);
    } catch (error) {
      this.error = error;
      await this.gladys.setConnectionStatus(false, errorMessage(error));
      return;
    }
    const generation = this.generation;
    await this.history.load();
    if (generation === this.generation) await this.refresh();
  }
  async refresh() {
    if (!this.client) return;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const client = this.client;
    clearTimeout(this.timer);
    const work = async () => {
      try {
        const servers = array(await client.get('/servers')).map(normalizeServer);
        const resources = (
          await mapLimit(servers, async (server) =>
            array(await client.get(`/servers/${server.uuid}/resources`)).map((raw) =>
              normalizeResource(raw, server),
            ),
          )
        ).flat();
        if (generation !== this.generation) return;
        if (servers.length + resources.length > 2000) throw new CoolifyError('response');
        this.snapshot = { servers, resources, at: this.now() };
        this.error = null;
        await this.gladys.publishDiscoveredDevices(
          devices(this.gladys, this.config, this.snapshot),
        );
        if (generation !== this.generation) return;
        await this.publishStates();
        if (generation !== this.generation) return;
        await this.gladys.setConnectionStatus(true);
        if (generation === this.generation) this.startMonitoring();
      } catch (error) {
        if (generation !== this.generation) return;
        this.error = error;
        clearTimeout(this.httpTimer);
        this.httpTimer = undefined;
        for (const key of this.transitions.entries.keys())
          this.transitions.observe(key, null, this.config.confirmations);
        await this.gladys.setConnectionStatus(false, errorMessage(error)).catch(() => {});
      } finally {
        await this.history.prune();
        if (generation === this.generation) {
          this.pending = null;
          this.timer = setTimeout(() => void this.refresh(), this.config.interval * 1000);
          this.timer.unref?.();
        }
      }
    };
    this.pending = work();
    return this.pending;
  }
  ensureHttpMonitoring(resource) {
    if (!this.client || this.error || resource.kind !== 'application') return 'pending';
    if (this.config.httpMode === 'all') return 'active';
    if (this.config.httpMode === 'off') return 'off';
    const id = externalId(this.gladys, this.config, resource, 'resource').device;
    const legacy = legacyExternalId(this.gladys, this.config, resource, 'resource').device;
    if (this.config.httpResources.some((value) => [id, legacy].includes(value))) return 'active';
    const previous = this.httpActivation.get(id);
    if (previous && (previous.status === 'pending' || this.now() - previous.at < 30000))
      return previous.status;
    const generation = this.generation;
    this.httpActivation.set(id, { status: 'pending', at: this.now() });
    // Serialize widget activations: two widgets must not overwrite each other's selection.
    this.activationQueue = this.activationQueue.then(async () => {
      if (generation !== this.generation) return;
      if (this.config.httpResources.length >= 20) {
        this.httpActivation.set(id, { status: 'limit', at: this.now() });
        this.gladys.requestWidgetRefresh('health');
        return;
      }
      try {
        const imported = await this.gladys.getDevices();
        if (generation !== this.generation) return;
        const reference = imported.find((device) =>
          [id, legacy].includes(device.external_id),
        )?.external_id;
        if (!reference) throw new Error('Application must be imported');
        const resources = [...new Set([...this.config.httpResources, reference])];
        await this.gladys.setConfig({ http_resources: resources });
        if (generation !== this.generation) return;
        // SDK writes are partial merges, with no config-updated echo.
        this.config = { ...this.config, httpResources: resources };
        this.httpActivation.delete(id);
        await this.healthPending;
        if (generation === this.generation && !this.health.has(resource.uuid))
          await this.startMonitoring(new Set([resource.uuid]));
      } catch {
        if (generation === this.generation) {
          this.httpActivation.set(id, { status: 'save_error', at: this.now() });
          this.gladys.requestWidgetRefresh('health');
        }
      }
    });
    return 'pending';
  }
  startMonitoring(onlyHttp = null) {
    if (this.healthPending || !this.snapshot || !this.client || this.error)
      return this.healthPending;
    const generation = this.generation;
    const snapshot = this.snapshot;
    const client = this.client;
    const config = this.config;
    const signal = this.healthAbort.signal;
    // Probes and event enrichment must not hold up inventory refresh or widgets.
    this.healthPending = this.monitorSnapshot(
      snapshot,
      client,
      config,
      generation,
      signal,
      onlyHttp,
    )
      .catch(() => logger.warn('Monitoring cycle failed. It will resume after the next inventory.'))
      .finally(() => {
        if (generation === this.generation) {
          this.healthPending = null;
          this.scheduleHttp();
        }
      });
    return this.healthPending;
  }
  scheduleHttp() {
    clearTimeout(this.httpTimer);
    this.httpTimer = undefined;
    if (!this.client || this.error || !this.nextHttp.size) return;
    const delay = Math.max(1000, Math.min(...this.nextHttp.values()) - this.now());
    this.httpTimer = setTimeout(
      () => void this.startMonitoring(new Set(this.nextHttp.keys())),
      delay,
    );
    this.httpTimer.unref?.();
  }
  async applicationUrl(resource, client = this.client) {
    if (resource.kind !== 'application') return null;
    return applicationUrl(await client.get(`/applications/${resource.uuid}`, 300));
  }
  async monitorSnapshot(snapshot, client, config, generation, signal, onlyHttp = null) {
    const valid = () => generation === this.generation && !this.error && !signal.aborted;
    const imported = await this.gladys.getDevices();
    if (!valid()) return;
    const selected = new Set(config.httpResources);
    const events = [];
    const entities = [
      ...snapshot.servers.map((entity) => ({
        entity,
        type: 'server',
        state: serverStatus(entity),
      })),
      ...snapshot.resources.map((entity) => ({
        entity,
        type: 'resource',
        state: status(entity.status),
      })),
    ];
    const live = new Set();
    for (const { entity, type, state } of onlyHttp ? [] : entities) {
      const ids = externalId(this.gladys, config, entity, type);
      const legacy = legacyExternalId(this.gladys, config, entity, type);
      // Use the actual imported reference so a scene's device filter matches.
      const device = imported.find((item) =>
        [ids.device, legacy.device].includes(item.external_id),
      );
      const reference = device?.external_id || ids.device;
      const key = `coolify:${ids.device}`;
      live.add(key);
      const available = state.group === 'unknown' ? null : state.group === 'running';
      if (events.length >= 80) continue;
      if (this.transitions.observe(key, available, config.confirmations)) {
        events.push({
          key: `${type}_${available ? 'recovered' : 'unavailable'}`,
          entity,
          data: {
            device: reference,
            name: entity.name,
            server: entity.serverName || entity.name,
            status: localize(state.text, config.language),
            checked_at: new Date(snapshot.at).toISOString(),
          },
        });
      }
    }
    const targets = snapshot.resources.filter(
      (resource) =>
        resource.kind === 'application' &&
        (!onlyHttp || onlyHttp.has(resource.uuid)) &&
        (config.httpMode === 'all' ||
          (config.httpMode === 'manual' &&
            [
              externalId(this.gladys, config, resource, 'resource').device,
              legacyExternalId(this.gladys, config, resource, 'resource').device,
            ].some((id) => selected.has(id)))),
    );
    for (const resource of targets)
      live.add(`http:${externalId(this.gladys, config, resource, 'resource').device}`);
    if (!onlyHttp) {
      for (const key of this.transitions.entries.keys())
        if (!live.has(key)) this.transitions.entries.delete(key);
      const currentTargets = new Set(targets.map((resource) => resource.uuid));
      for (const key of this.health.keys()) if (!currentTargets.has(key)) this.health.delete(key);
      for (const key of this.nextHttp.keys())
        if (!currentTargets.has(key)) this.nextHttp.delete(key);
    }
    await mapLimit(targets, async (resource) => {
      if (!valid()) return;
      if ((this.nextHttp.get(resource.uuid) || 0) > this.now()) return;
      this.nextHttp.set(resource.uuid, this.now() + HTTP_INTERVAL);
      let url;
      try {
        url = await this.applicationUrl(resource, client);
      } catch {
        if (valid()) {
          this.health.set(resource.uuid, {
            ...this.health.get(resource.uuid),
            error: 'domain',
            at: this.now(),
          });
          this.transitions.observe(
            `http:${externalId(this.gladys, config, resource, 'resource').device}`,
            null,
            config.confirmations,
          );
        }
        return;
      }
      if (!valid()) return;
      const id = externalId(this.gladys, config, resource, 'resource').device;
      const key = `http:${id}`;
      const previous = this.health.get(resource.uuid);
      if (previous?.url !== url) this.transitions.entries.delete(key);
      if (!url) {
        this.health.set(resource.uuid, { error: 'no_domain', at: this.now(), samples: [] });
        this.transitions.observe(key, null, config.confirmations);
        return;
      }
      const storageKey = historyKey(config, resource, url);
      const history = this.history.samples(storageKey);
      const last = history.at(-1);
      if (last && last.at + HTTP_INTERVAL > this.now()) {
        this.health.set(resource.uuid, { url, ...last, samples: history });
        this.nextHttp.set(resource.uuid, last.at + HTTP_INTERVAL);
        return;
      }
      const result = await this.probe(url, {
        signal,
        timeout: config.httpTimeout,
        codes: config.httpCodes,
      });
      if (!valid() || !result) return;
      const sample = { ...result, at: this.now() };
      const samples = await this.history.record(storageKey, sample);
      if (!valid()) return;
      this.nextHttp.set(resource.uuid, sample.at + HTTP_INTERVAL);
      this.health.set(resource.uuid, { url, ...sample, samples });
      if (events.length < 100 && this.transitions.observe(key, result.ok, config.confirmations)) {
        const legacy = legacyExternalId(this.gladys, config, resource, 'resource').device;
        const reference =
          imported.find((item) => [id, legacy].includes(item.external_id))?.external_id || id;
        events.push({
          key: `http_${result.ok ? 'recovered' : 'unavailable'}`,
          entity: resource,
          data: {
            device: reference,
            name: resource.name,
            server: resource.serverName,
            url,
            http_code: result.code,
            response_ms: result.ms,
            checked_at: new Date(sample.at).toISOString(),
          },
        });
      }
    });
    await mapLimit(events, async (event) => {
      if (!valid()) return;
      if (!('url' in event.data)) {
        try {
          event.data.url = (await this.applicationUrl(event.entity, client)) || '';
        } catch {
          event.data.url = '';
        }
      }
      if (!valid()) return;
      // Do not retry an ambiguous ACK: a notification may already have run.
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch(() =>
          logger.warn('Scene event delivery failed; not retried to avoid duplicate notifications.'),
        );
    });
    if (valid()) this.gladys.requestWidgetRefresh('health');
  }
  async publishStates() {
    if (!this.snapshot) return;
    const generation = this.generation;
    const selected = new Set((await this.gladys.getDevices()).map((device) => device.external_id));
    if (generation !== this.generation || !this.snapshot) return;
    const entries = [
      ...this.snapshot.servers.map((entity) => ({
        entity,
        type: 'server',
        state: serverStatus(entity),
      })),
      ...this.snapshot.resources.map((entity) => ({
        entity,
        type: 'resource',
        state: status(entity.status),
      })),
    ];
    const changes = entries.flatMap(({ entity, type, state }) => {
      const text = localize(state.text, this.config.language);
      const ids = [
        externalId(this.gladys, this.config, entity, type),
        legacyExternalId(this.gladys, this.config, entity, type),
      ];
      const seen = new Set();
      return ids.flatMap((id) => {
        const feature = id.feature('status');
        if (seen.has(feature) || !selected.has(id.device) || this.sent.get(feature) === text)
          return [];
        seen.add(feature);
        return [{ device_feature_external_id: feature, text }];
      });
    });
    // At most 100 updates per cycle (30s minimum): below Gladys' 300/minute budget.
    const batch = changes.slice(0, 100);
    if (batch.length) {
      await this.gladys.publishStates(batch);
      batch.forEach((entry) => this.sent.set(entry.device_feature_external_id, entry.text));
    }
  }
  resolve(reference, type) {
    const values = type === 'server' ? this.snapshot?.servers : this.snapshot?.resources;
    return values?.find(
      (entity) =>
        externalId(this.gladys, this.config, entity, type).device === reference ||
        legacyExternalId(this.gladys, this.config, entity, type).device === reference,
    );
  }
  async deployments(resource, skip = 0) {
    const generation = this.generation;
    if (!this.client) throw new CoolifyError('config');
    const data = await this.client.get(
      `/deployments/applications/${resource.uuid}?skip=${skip}&take=50`,
      30,
    );
    if (generation !== this.generation) throw new CoolifyError('config');
    if (!data || typeof data !== 'object') throw new CoolifyError('response');
    return array(data.deployments)
      .map(normalizeDeployment)
      .sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0));
  }
}
