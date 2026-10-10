import { GladysIntegration, createLogger } from '@gladysassistant/integration-sdk';
import { Monitor } from './src/monitor.js';
import { HttpHistory } from './src/history.js';
import { renderWidget, WIDGET_KEYS } from './src/widgets.js';
import { errorMessage, localize, t } from './src/i18n.js';
import { pathToFileURL } from 'node:url';

export function register(gladys, options) {
  const monitor = new Monitor(gladys, {
    history: new HttpHistory({ directory: process.env.COOLIFY_DATA_DIR || '/data/http-history' }),
    ...options,
  });
  const refreshWidgets = () => WIDGET_KEYS.forEach((key) => gladys.requestWidgetRefresh(key));
  gladys.onConfigUpdated(async (config) => {
    await monitor.configure(config);
    refreshWidgets();
  });
  gladys.on('connected', () => {
    void gladys
      .getConfig()
      .then((config) => monitor.configure(config))
      .then(refreshWidgets)
      .catch(() => {});
  });
  gladys.on('disconnected', () => monitor.stop());
  gladys.onScanRequest(async () => {
    void monitor.refresh();
    if (monitor.snapshot)
      await gladys.publishDiscoveredDevices(
        (await import('./src/model.js')).devices(gladys, monitor.config, monitor.snapshot),
      );
  });
  gladys.onDeviceCreated(() => monitor.publishStates());
  gladys.onAction('test_connection', async () => {
    await monitor.configure(await gladys.getConfig());
    refreshWidgets();
    if (monitor.error)
      throw new Error(localize(errorMessage(monitor.error), monitor.config?.language));
    return t(
      'Connected to Coolify. Discovery updated.',
      'Connexion à Coolify réussie. Découverte actualisée.',
    );
  });
  for (const key of WIDGET_KEYS) {
    gladys.onWidgetGet(key, (context) => renderWidget(key, monitor, context));
    gladys.onWidgetAction(key, async (actionKey) => {
      if (actionKey !== 'refresh') throw new Error('Unknown action / Action inconnue');
      // Background collection can involve many servers; never block the widget ACK.
      monitor.client?.cache.clear();
      void monitor.refresh().then(refreshWidgets);
      return t('Refresh requested.', 'Actualisation demandée.');
    });
  }
  gladys.handleShutdown(async () => {
    monitor.stop();
    await monitor.history.flush();
  });
  return monitor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gladys = new GladysIntegration();
  register(gladys);
  await gladys.connect().catch(() => {
    createLogger({ name: 'coolify' }).error('Unable to connect to Gladys');
    process.exitCode = 1;
  });
}
