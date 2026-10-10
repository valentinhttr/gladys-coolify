import { bounded } from './client.js';
import { historyView, HTTP_INTERVAL } from './history.js';
import { clip, status, serverStatus, kindLabel } from './model.js';
import { t, messages, errorMessage, localize } from './i18n.js';

export const WIDGET_KEYS = ['overview', 'resource', 'deployments', 'health'];
const text = (value, variant = 'body') => ({ type: 'text', variant, text: value });
const tile = (label, value, color = 'neutral', unit) => ({
  type: 'value',
  label,
  value,
  color,
  ...(unit ? { unit } : {}),
});
const row = (label, value, color = 'neutral') => ({ label, value, color });
const enabled = (settings, key) => settings[key] !== false;
const selectedFields = (settings, defaults) =>
  Array.isArray(settings.fields) ? settings.fields : defaults;
const refreshButton = {
  type: 'button',
  label: t('Refresh', 'Actualiser'),
  icon: 'refresh-cw',
  action: { key: 'refresh' },
};
const formatDate = (value, language) =>
  new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(value))
    .replace(', ', ' ') + ' UTC';
const deploymentStatus = (value) =>
  ({
    finished: { text: t('Success', 'Réussi'), color: 'success' },
    failed: { text: t('Failed', 'Échoué'), color: 'danger' },
    cancelled: { text: t('Cancelled', 'Annulé'), color: 'neutral' },
  })[value] || status(value);

function resourceCards(resources, settings) {
  return {
    type: 'card-list',
    display: settings.layout === 'grid' ? 'grid' : 'list',
    items: resources.map((resource) => ({
      title: clip(resource.name, 60),
      subtitle: clip(resource.serverName, 60),
      badge: { text: status(resource.status).text, color: status(resource.status).color },
      description: kindLabel(resource.kind),
    })),
  };
}

export async function renderWidget(key, monitor, { settings = {}, language = 'en' } = {}) {
  const ttl = bounded(settings.refresh_interval, 60, 30, 3600);
  const components = [];
  const done = () => ({ ttl_seconds: ttl, components });
  if (!monitor.snapshot) {
    components.push(
      text(monitor.error ? errorMessage(monitor.error) : messages.loading),
      refreshButton,
    );
    return done();
  }
  const { snapshot } = monitor;
  const fields = selectedFields(
    settings,
    key === 'deployments' ? [] : ['status', 'server', 'type', 'deployment', 'commit', 'duration'],
  );
  let server;
  if (settings.server && key === 'overview') {
    server = monitor.resolve(settings.server, 'server');
    if (!server) {
      components.push(
        text(
          t(
            'Select a Server device. A resource cannot be used as a server filter.',
            'Choisissez un appareil Serveur. Une ressource ne peut pas servir de filtre serveur.',
          ),
        ),
      );
      return done();
    }
  }
  let resource;
  if (['resource', 'deployments', 'health'].includes(key)) {
    resource = monitor.resolve(settings.resource, 'resource');
    if (!resource) {
      components.push(text(messages.select));
      return done();
    }
  }
  const defaultTitle = key === 'overview' ? server?.name || 'Coolify' : resource.name;
  components.push(text(clip(settings.title || defaultTitle, 40), 'heading'));
  // A failed inventory never shows old green badges as if they were current.
  if (monitor.error) {
    components.push(
      text(
        t(
          `${messages.stale.en} ${errorMessage(monitor.error).en}`,
          `${messages.stale.fr} ${errorMessage(monitor.error).fr}`,
        ),
      ),
    );
    components.push(
      {
        type: 'status',
        items: [
          row(
            t('Last successful check', 'Dernière vérification'),
            formatDate(snapshot.at, language),
            'warning',
          ),
        ],
      },
      refreshButton,
    );
    return done();
  }
  if (key === 'health') {
    const activation =
      monitor.config?.httpMode === 'off'
        ? 'off'
        : monitor.config?.httpMode === 'all' || enabled(settings, 'auto_monitor')
          ? monitor.ensureHttpMonitoring(resource)
          : 'disabled';
    const health = monitor.health?.get(resource.uuid);
    if (resource.kind !== 'application')
      components.push(
        text(
          t(
            'Select an application with an HTTP domain.',
            'Choisissez une application avec un domaine HTTP.',
          ),
        ),
      );
    else if (!health)
      components.push(
        text(
          t(
            activation === 'off'
              ? 'HTTP monitoring is disabled in the Coolify integration settings.'
              : activation === 'limit'
                ? '20 applications are already monitored. Free a slot in Coolify integration settings.'
                : activation === 'save_error'
                  ? 'Could not enable monitoring. Check the integration connection, then refresh.'
                  : activation === 'disabled'
                    ? 'Enable automatic monitoring in this widget, or select the application in Coolify integration settings.'
                    : 'Monitoring starts automatically. The first HTTP check is in progress…',
            activation === 'off'
              ? 'La surveillance HTTP est désactivée dans les paramètres de l’intégration Coolify.'
              : activation === 'limit'
                ? '20 applications sont déjà surveillées. Libérez une place dans les paramètres de l’intégration Coolify.'
                : activation === 'save_error'
                  ? 'Impossible d’activer la surveillance. Vérifiez la connexion de l’intégration, puis actualisez.'
                  : activation === 'disabled'
                    ? 'Activez la surveillance automatique dans ce widget, ou sélectionnez l’application dans les paramètres de l’intégration Coolify.'
                    : 'La surveillance démarre automatiquement. Premier contrôle HTTP en cours…',
          ),
        ),
      );
    else if (health.error)
      components.push(
        text(
          health.error === 'no_domain'
            ? t(
                'No usable HTTP domain configured in Coolify. Compose services are not probed.',
                'Aucun domaine HTTP utilisable dans Coolify. Les services Compose ne sont pas sondés.',
              )
            : t(
                'Cannot read the application domain. Check Coolify access.',
                'Impossible de lire le domaine de l’application. Vérifiez l’accès Coolify.',
              ),
        ),
      );
    else {
      const details = selectedFields(settings, ['url', 'code', 'checked', 'window']);
      const view = historyView(health.samples, settings.chart_type, monitor.now());
      const samples = view.samples;
      const stale = monitor.now() - health.at > HTTP_INTERVAL * 2;
      const successful = samples.filter((sample) => sample.ok).length;
      if (enabled(settings, 'show_stats'))
        components.push(
          tile(
            t('Successful checks', 'Contrôles réussis'),
            samples.length ? Math.round((successful / samples.length) * 10000) / 100 : '—',
            'neutral',
            '%',
          ),
          tile(
            t('Response time', 'Temps de réponse'),
            health.ms ?? '—',
            stale ? 'warning' : health.ok ? 'success' : 'danger',
            health.ms === null ? undefined : 'ms',
          ),
          tile(
            t('Failed checks', 'Échecs'),
            samples.length - successful,
            successful === samples.length ? 'neutral' : 'danger',
          ),
        );
      if (enabled(settings, 'show_chart')) {
        const points = view.buckets
          .filter((bucket) => bucket.count)
          .map((bucket) => ({
            t: new Date(bucket.at).toISOString(),
            v: Math.round(bucket.sum / bucket.count),
          }));
        if (points.length >= 2) {
          const first = Date.parse(points[0].t);
          const last = Date.parse(points.at(-1).t);
          components.push({
            type: 'chart',
            chart_type: view.gaps
              ? 'bar'
              : settings.chart_type?.startsWith('line')
                ? 'line'
                : 'area',
            title:
              view.days === 1
                ? t('Response time · 24 h (ms)', 'Temps de réponse · 24 h (ms)')
                : view.days === 7
                  ? t('Hourly average · 7 days (ms)', 'Moyenne horaire · 7 jours (ms)')
                  : t('3-hour average · 30 days (ms)', 'Moyenne sur 3 h · 30 jours (ms)'),
            unit: 'ms',
            series: [{ name: t('Response time', 'Temps de réponse'), points }],
            annotations: view.buckets
              .filter((bucket) => bucket.failures && bucket.at >= first && bucket.at <= last)
              .slice(-8)
              .map((bucket) => ({
                t: new Date(bucket.at).toISOString(),
                ...(bucket.count ? { value: Math.round(bucket.sum / bucket.count) } : {}),
                color: 'danger',
                label: t(
                  `${bucket.failures} failed`,
                  `${bucket.failures} échec${bucket.failures > 1 ? 's' : ''}`,
                ),
              })),
          });
        } else
          components.push(
            text(
              points.length === 1
                ? t(
                    'First response measured. The chart appears once two time intervals contain responses.',
                    'Première réponse mesurée. Le graphique apparaîtra après des réponses dans deux tranches horaires.',
                  )
                : t(
                    'No response time in this period. Failures remain included in the statistics.',
                    'Aucun temps de réponse sur cette période. Les échecs restent inclus dans les statistiques.',
                  ),
            ),
          );
      }
      const rows = [
        row(
          t('HTTP check', 'Contrôle HTTP'),
          stale
            ? t('Outdated', 'Ancien résultat')
            : health.ok
              ? t('Available', 'Disponible')
              : t('Failed', 'Échec'),
          stale ? 'warning' : health.ok ? 'success' : 'danger',
        ),
        row(
          t('Period', 'Période'),
          view.days === 1 ? '24 h' : t(`${view.days} days`, `${view.days} jours`),
        ),
        row(t('Checks', 'Contrôles'), samples.length),
      ];
      if (details.includes('url'))
        rows.push(row(t('Domain', 'Domaine'), clip(new URL(health.url).host, 40)));
      if (details.includes('code'))
        rows.push(
          row(
            t('HTTP code', 'Code HTTP'),
            health.code ?? t('Network / TLS / timeout', 'Réseau / TLS / délai'),
          ),
        );
      if (details.includes('checked'))
        rows.push(row(t('Checked', 'Vérifié'), formatDate(health.at, language)));
      if (details.includes('window'))
        rows.push(
          row(t('Since', 'Depuis'), samples.length ? formatDate(samples[0].at, language) : '—'),
        );
      if (view.buckets.filter((bucket) => bucket.failures).length > 8)
        rows.push(
          row(
            t('Red markers', 'Repères rouges'),
            t('Last 8 failed intervals', '8 dernières tranches en échec'),
            'danger',
          ),
        );
      if (monitor.history?.error)
        rows.push(
          row(
            t('History storage', 'Sauvegarde historique'),
            t('Incomplete / write failed', 'Incomplet / écriture impossible'),
            'warning',
          ),
        );
      components.push({ type: 'status', items: rows });
      if (enabled(settings, 'show_link'))
        components.push({
          type: 'button',
          label: t('Open application', 'Ouvrir l’application'),
          link: { url: health.url },
          icon: 'external-link',
        });
    }
    if (enabled(settings, 'show_refresh')) components.push(refreshButton);
    return done();
  }
  if (key === 'overview') {
    let resources = snapshot.resources.filter((item) => !server || item.server === server.uuid);
    if (Array.isArray(settings.kinds))
      resources = resources.filter((item) => settings.kinds.includes(item.kind));
    if (settings.state && settings.state !== 'all')
      resources = resources.filter((item) => status(item.status).group === settings.state);
    if (settings.search)
      resources = resources.filter((item) =>
        item.name.toLowerCase().includes(String(settings.search).toLowerCase()),
      );
    resources = [...resources].sort((a, b) => {
      if (settings.sort !== 'name') {
        const diff =
          Number(status(a.status).group !== 'issues') - Number(status(b.status).group !== 'issues');
        if (diff) return diff;
      }
      return a.name.localeCompare(b.name, language);
    });
    if (enabled(settings, 'show_counts')) {
      components.push(
        tile(t('Resources', 'Ressources'), resources.length),
        tile(
          t('Running', 'En marche'),
          resources.filter((r) => status(r.status).group === 'running').length,
          'success',
        ),
        tile(
          t('Needs attention', 'À vérifier'),
          resources.filter((r) => status(r.status).group === 'issues').length,
          'warning',
        ),
      );
    }
    const rows = server
      ? [row(t('Server', 'Serveur'), serverStatus(server).text, serverStatus(server).color)]
      : [
          row(
            t('Servers ready', 'Serveurs prêts'),
            `${snapshot.servers.filter((s) => serverStatus(s).group === 'running').length}/${snapshot.servers.length}`,
          ),
        ];
    if (enabled(settings, 'show_updated'))
      rows.push(row(t('Checked', 'Vérifié'), formatDate(snapshot.at, language)));
    const cards = ['grid', 'cards'].includes(settings.layout);
    // One native status list supports ten rows, including server/check metadata.
    const limit = bounded(
      settings.limit,
      6,
      1,
      cards ? (settings.layout === 'grid' ? 12 : 8) : 10 - rows.length - 1,
    );
    if (resources.length && cards)
      components.push(resourceCards(resources.slice(0, limit), settings));
    else if (resources.length)
      rows.unshift(
        ...resources
          .slice(0, limit)
          .map((item) =>
            row(clip(item.name, 40), status(item.status).text, status(item.status).color),
          ),
      );
    else components.push(text(messages.empty));
    if (resources.length > limit)
      rows.push(row(t('Shown / matching', 'Affichées / filtrées'), `${limit}/${resources.length}`));
    components.push({ type: 'status', items: rows });
  } else {
    const rows = [];
    if (fields.includes('status'))
      rows.push(
        row(t('Status', 'État'), status(resource.status).text, status(resource.status).color),
      );
    if (fields.includes('server'))
      rows.push(row(t('Server', 'Serveur'), clip(resource.serverName, 40)));
    if (fields.includes('type')) rows.push(row(t('Type', 'Type'), kindLabel(resource.kind)));
    if (
      key === 'deployments' ||
      fields.some((field) => ['deployment', 'commit', 'duration'].includes(field))
    ) {
      if (resource.kind !== 'application') {
        if (key === 'deployments') components.push(text(messages.application));
      } else {
        try {
          const deployments = await monitor.deployments(
            resource,
            bounded(settings.history_page, 1, 1, 1000) * 50 - 50,
          );
          if (key === 'deployments') {
            let matches = deployments;
            if (settings.result && settings.result !== 'all')
              matches = matches.filter((d) =>
                settings.result === 'failed'
                  ? d.status === 'failed'
                  : settings.result === 'success'
                    ? d.status === 'finished'
                    : ['in_progress', 'queued'].includes(d.status),
              );
            const cards = ['cards', 'grid'].includes(settings.layout);
            const detailRow = fields.includes('commit') || fields.includes('duration');
            const availableRows = 10 - rows.length - 1 - Number(enabled(settings, 'show_updated'));
            const limit = bounded(
              settings.limit,
              6,
              1,
              cards
                ? settings.layout === 'grid'
                  ? 12
                  : 8
                : Math.max(1, Math.floor(availableRows / (detailRow ? 2 : 1))),
            );
            if (!matches.length) components.push(text(messages.noDeployments));
            else if (!cards) {
              components.push(text(t('Dates in UTC', 'Dates en UTC'), 'caption'));
              rows.unshift(
                ...matches.slice(0, limit).flatMap((d) => {
                  const result = [
                    row(
                      d.created
                        ? formatDate(d.created, language).replace(' UTC', '')
                        : t('Date unavailable', 'Date indisponible'),
                      deploymentStatus(d.status).text,
                      deploymentStatus(d.status).color,
                    ),
                  ];
                  const commit = fields.includes('commit') && d.commit ? d.commit.slice(0, 7) : '';
                  const elapsed =
                    fields.includes('duration') && duration(d) !== null ? `${duration(d)} s` : '';
                  if (detailRow && (commit || elapsed))
                    result.push(
                      row(
                        commit ? `Commit ${commit}` : t('Total duration', 'Durée totale'),
                        elapsed || '—',
                      ),
                    );
                  return result;
                }),
              );
            } else
              components.push({
                type: 'card-list',
                display: settings.layout === 'grid' ? 'grid' : 'list',
                items: matches.slice(0, limit).map((d) => ({
                  title: d.created
                    ? formatDate(d.created, language)
                    : t('Date unavailable', 'Date indisponible'),
                  subtitle:
                    [
                      fields.includes('commit') && d.commit ? d.commit.slice(0, 7) : null,
                      fields.includes('duration') && duration(d) !== null
                        ? `${duration(d)} s`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined,
                  badge: {
                    text: deploymentStatus(d.status).text,
                    color: deploymentStatus(d.status).color,
                  },
                  description:
                    [
                      fields.includes('commit') && d.commit ? `Commit ${d.commit}` : null,
                      fields.includes('duration') && duration(d) !== null
                        ? `${localize(t('Total duration', 'Durée totale'), language)}: ${duration(d)} s`
                        : null,
                      d.finished
                        ? `${localize(t('Finished', 'Terminé'), language)}: ${formatDate(d.finished, language)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined,
                })),
              });
            rows.push(
              row(
                t('Page · shown / matching', 'Page · affichés / filtrés'),
                `${bounded(settings.history_page, 1, 1, 1000)} · ${Math.min(limit, matches.length)}/${matches.length}`,
              ),
            );
          } else if (deployments.length) {
            const latest = deployments[0];
            if (fields.includes('deployment')) {
              rows.push(
                row(
                  t('Latest attempt', 'Dernière tentative'),
                  deploymentStatus(latest.status).text,
                  deploymentStatus(latest.status).color,
                ),
              );
              if (latest.created)
                rows.push(row(t('Queued', 'Créé'), formatDate(latest.created, language)));
              const success = deployments.find((d) => d.status === 'finished');
              rows.push(
                row(
                  t('Last success¹', 'Dernier succès¹'),
                  success
                    ? success.finished
                      ? formatDate(success.finished, language)
                      : t('Date unavailable', 'Date indisponible')
                    : t('None in last 50', 'Aucun parmi les 50'),
                ),
              );
            }
            if (fields.includes('commit') && latest.commit)
              rows.push(row(t('Commit', 'Commit'), latest.commit));
            if (fields.includes('duration') && duration(latest) !== null)
              rows.push(row(t('Total duration', 'Durée totale'), `${duration(latest)} s`));
          } else rows.push(row(t('Deployments', 'Déploiements'), t('None', 'Aucun')));
        } catch (error) {
          components.push(text(errorMessage(error)));
        }
      }
    }
    if (enabled(settings, 'show_updated'))
      rows.push(row(t('Checked', 'Vérifié'), formatDate(snapshot.at, language)));
    if (rows.length) components.push({ type: 'status', items: rows.slice(0, 10) });
  }
  if (enabled(settings, 'show_refresh')) components.push(refreshButton);
  return done();
}
export function duration(deployment) {
  if (!deployment.created || !deployment.finished) return null;
  const seconds = Math.round(
    (Date.parse(deployment.finished) - Date.parse(deployment.created)) / 1000,
  );
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
