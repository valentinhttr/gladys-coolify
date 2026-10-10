export const t = (en, fr) => ({ en, fr });
export const messages = {
  http_config: t(
    'Use HTTP codes such as 200-399 or 200-399,401.',
    'Utilisez des codes HTTP comme 200-399 ou 200-399,401.',
  ),
  config: t(
    'Enter the Coolify URL and a read-only API token in Configuration.',
    'Saisissez l’URL Coolify et un token API en lecture seule dans Configuration.',
  ),
  url: t(
    'Use an HTTP(S) instance URL without credentials, query or fragment.',
    'Utilisez une URL HTTP(S) sans identifiants, paramètres ni fragment.',
  ),
  auth: t(
    'Token rejected. Check its team, expiry and read permission.',
    'Token refusé. Vérifiez son équipe, son expiration et le droit read.',
  ),
  forbidden: t(
    'Access denied. Check read permission, API access and the IP allowlist.',
    'Accès refusé. Vérifiez le droit read, l’accès API et les IP autorisées.',
  ),
  missing: t(
    'Resource unavailable. Refresh discovery and check the token’s team.',
    'Ressource indisponible. Actualisez la découverte et vérifiez l’équipe du token.',
  ),
  rate: t(
    'Coolify rate limit reached. Refresh will resume automatically.',
    'Limite de requêtes Coolify atteinte. La reprise est automatique.',
  ),
  network: t(
    'Coolify is unreachable. Check the URL, network and TLS certificate.',
    'Coolify est injoignable. Vérifiez l’URL, le réseau et le certificat TLS.',
  ),
  response: t(
    'Unexpected Coolify response. Check the instance URL and API version.',
    'Réponse Coolify inattendue. Vérifiez l’URL de l’instance et la version API.',
  ),
  loading: t('Loading Coolify inventory…', 'Chargement de l’inventaire Coolify…'),
  stale: t(
    'Refresh failed. Current states are unavailable.',
    'Actualisation échouée. Les états actuels sont indisponibles.',
  ),
  select: t(
    'Add discovered devices in the integration, then select one in this widget’s settings.',
    'Ajoutez les appareils découverts dans l’intégration, puis sélectionnez-en un dans les réglages du widget.',
  ),
  mismatch: t(
    'This resource does not belong to the selected server.',
    'Cette ressource n’appartient pas au serveur sélectionné.',
  ),
  application: t(
    'Select an application. Deployment history is not available for databases or services.',
    'Sélectionnez une application. L’historique des déploiements n’est pas disponible pour les bases ou services.',
  ),
  empty: t('No matching resource.', 'Aucune ressource correspondante.'),
  noDeployments: t(
    'No deployment in the selected history window.',
    'Aucun déploiement dans la fenêtre d’historique sélectionnée.',
  ),
  metrics: t(
    'CPU, memory and disk measurements are not exposed by the public Coolify API.',
    'Les mesures CPU, mémoire et disque ne sont pas exposées par l’API publique Coolify.',
  ),
};
export class CoolifyError extends Error {
  constructor(code) {
    super(messages[code]?.en || messages.response.en);
    this.code = code;
  }
}
export const errorMessage = (error) => messages[error?.code] || messages.network;
export const localize = (message, language) => message[language === 'fr' ? 'fr' : 'en'];
