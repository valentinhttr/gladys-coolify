import { createHash } from 'node:crypto';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { CoolifyError, t, localize } from './i18n.js';

export const clip = (value, length) => String(value ?? '').slice(0, length);
export const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};
export function status(raw) {
  const value = String(raw || 'unknown').toLowerCase();
  if (value.includes('unhealthy') || /^(failed|error|exited|dead)/.test(value))
    return { text: t('Unhealthy', 'En erreur'), color: 'danger', group: 'issues' };
  if (/^(running|finished)/.test(value))
    return {
      text: value.startsWith('finished') ? t('Succeeded', 'Réussi') : t('Running', 'En marche'),
      color: 'success',
      group: 'running',
    };
  if (/^(in_progress|queued|starting|restarting|degraded)/.test(value))
    return { text: t('In progress', 'En cours'), color: 'warning', group: 'issues' };
  if (/^(stopped|exited|cancelled)/.test(value))
    return { text: t('Stopped', 'Arrêté'), color: 'neutral', group: 'stopped' };
  return { text: t('Unknown', 'Inconnu'), color: 'neutral', group: 'unknown' };
}
export const serverStatus = (server) =>
  server.reachable === false
    ? { text: t('Unreachable', 'Injoignable'), color: 'danger', group: 'issues' }
    : server.usable === false
      ? { text: t('Unusable', 'Inutilisable'), color: 'warning', group: 'issues' }
      : server.reachable === true && server.usable === true
        ? { text: t('Ready', 'Prêt'), color: 'success', group: 'running' }
        : { text: t('Unknown', 'Inconnu'), color: 'neutral', group: 'unknown' };
const bool = (value) =>
  typeof value === 'boolean' ? value : [0, 1].includes(value) ? Boolean(value) : null;
export const kind = (value) =>
  value === 'application'
    ? 'application'
    : value === 'service'
      ? 'service'
      : String(value).startsWith('standalone-')
        ? 'database'
        : 'other';
export const kindLabel = (value) =>
  ({
    application: t('Application', 'Application'),
    service: t('Service', 'Service'),
    database: t('Database', 'Base de données'),
    other: t('Resource', 'Ressource'),
  })[value];
export function array(value) {
  if (!Array.isArray(value)) throw new CoolifyError('response');
  return value;
}
export function normalizeServer(raw) {
  if (!validId(raw?.uuid)) throw new CoolifyError('response');
  return {
    uuid: raw.uuid,
    name: clip(raw.name || raw.uuid, 100),
    reachable: bool(raw.is_reachable ?? raw.settings?.is_reachable),
    usable: bool(raw.is_usable ?? raw.settings?.is_usable),
  };
}
export function normalizeResource(raw, server) {
  if (!validId(raw?.uuid)) throw new CoolifyError('response');
  return {
    uuid: raw.uuid,
    name: clip(raw.name || raw.uuid, 100),
    server: server.uuid,
    serverName: server.name,
    kind: kind(raw.type),
    status: clip(raw.status || 'unknown', 40),
  };
}
export function normalizeDeployment(raw) {
  return {
    uuid: clip(raw.deployment_uuid, 100),
    status: clip(raw.status || 'unknown', 40),
    commit: /^[a-f0-9]{7,64}$/i.test(raw.commit || '') ? raw.commit.slice(0, 12) : undefined,
    created: date(raw.created_at),
    finished: date(raw.finished_at),
    started: date(raw.started_at),
  };
}
export function legacyExternalId(gladys, config, entity, type) {
  const instance = createHash('sha256').update(config.url).digest('hex').slice(0, 12);
  return gladys.externalIds(
    type,
    `${instance}-${entity.server ? `${entity.server}-` : ''}${entity.uuid}`,
  );
}
export function externalId(gladys, config, entity, type) {
  const legacy = legacyExternalId(gladys, config, entity, type);
  // Gladys rejects widget setting strings over 100 characters before invoking
  // the integration. Coolify's server + resource UUIDs exceed that bound with
  // the real repository installation selector (short test selectors did not).
  if (legacy.device.length <= 100) return legacy;
  const key = createHash('sha256')
    .update(JSON.stringify([config.url, type, entity.server || '', entity.uuid]))
    .digest('hex')
    .slice(0, 24);
  return gladys.externalIds(type, key);
}
export function devices(gladys, config, snapshot) {
  return [
    ...snapshot.servers.map((entity) => ({ entity, type: 'server' })),
    ...snapshot.resources.map((entity) => ({ entity, type: 'resource' })),
  ].map(({ entity, type }) => {
    const ids = externalId(gladys, config, entity, type);
    return {
      name: clip(
        type === 'server'
          ? `${localize(t('Server', 'Serveur'), config.language)} · ${entity.name}`
          : `${entity.serverName} · ${entity.name}`,
        100,
      ),
      external_id: ids.device,
      features: [
        {
          name: localize(t('Status', 'État'), config.language),
          external_id: ids.feature('status'),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          min: 0,
          max: 0,
          read_only: true,
          has_feedback: false,
          keep_history: false,
        },
      ],
    };
  });
}
