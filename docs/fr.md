# Surveiller Coolify dans Gladys

Nécessite **Gladys 5.1.0 ou plus récent**, et une instance Coolify v4 proposant l’API publique `/api/v1`. Le SDK utilisé est **0.15.0**. Les champs disponibles varient selon la version de Coolify : une information absente n’est jamais estimée.

## Créer le token

1. Dans Coolify, sélectionnez **l’équipe à surveiller** : le token est lié à cette équipe.
2. Ouvrez **Keys & Tokens → API tokens → Create New Token** et nommez-le `Gladys monitoring`.
3. Activez **uniquement `read`**. Les droits `read:sensitive`, `write`, `deploy` et `root` sont inutiles. L’intégration ne lit ni variables d’environnement, ni clés privées, ni logs, et ne lance aucune commande de déploiement, d’arrêt ou de redémarrage.
4. En auto-hébergement, activez l’accès API dans **Settings**. Si une liste d’IP autorisées est configurée, ajoutez l’adresse depuis laquelle le conteneur Gladys joint Coolify : éventuellement l’IP publique/NAT, pas celle du navigateur.
5. Copiez le token dans le champ **Token API** de l’intégration. Pour le renouveler, créez-en un autre dans Coolify puis remplacez-le ici.

Voir les [permissions Coolify](https://coolify.io/docs/api/permissions) et le [contrôle d’accès API/IP](https://coolify.io/docs/api/ip-allowlist).

## Installation et paramètres

Tant que le référencement dans le store est désactivé, téléchargez le manifeste joint à une release GitHub et collez-le dans **Intégrations → Installer une intégration → Mode développeur**. L’image GHCR correspondante doit être publique. Utilisez le manifeste de la release pour conserver l’association version/image.

Renseignez l’URL, par exemple `https://coolify.exemple.fr` (le suffixe `/api/v1` est facultatif), et le token. Utilisez HTTPS pour une instance distante ; HTTP reste accepté sur un réseau local de confiance. La vérification TLS reste active et les redirections sont refusées : utilisez l’URL finale. Dans le conteneur de l’intégration, `localhost` désigne ce conteneur.

Choisissez l’intervalle d’inventaire, de 30 à 3600 secondes (60 par défaut), et la langue de nommage des appareils. Enregistrez puis cliquez sur **Tester la connexion et découvrir**. L’indicateur signale la connexion à Coolify indépendamment du lien avec Gladys.

L’inventaire Coolify est découvert automatiquement. Dans **Découverte**, ajoutez seulement les serveurs et ressources à sélectionner dans vos widgets ou à utiliser comme appareils Gladys. Ajouter toutes les applications n’est pas nécessaire. Les serveurs sont préfixés `Serveur` ou `Server` ; les ressources sont nommées `Nom du serveur · Nom de la ressource`. Les appareils déjà ajoutés conservent les noms choisis par l’utilisateur. Leur fonctionnalité textuelle en lecture seule décrit l’état dans la langue configurée. Les widgets suivent automatiquement la langue française ou anglaise du lecteur.

## Composer le tableau de bord

- **Vue d’ensemble** regroupe la surveillance de l’instance et celle d’un serveur. Laissez **Serveur (facultatif)** vide pour tous les serveurs, sans importer d’appareil. Sélectionnez un appareil Serveur pour afficher son nom, sa disponibilité et uniquement ses ressources. Une application choisie comme serveur produit une erreur explicite. Filtrez aussi par type, état ou nom. Les compteurs concernent les résultats filtrés. Triez par nom ou placez les problèmes en premier.
- **Application / ressource** nécessite uniquement une ressource ; son serveur est déduit automatiquement. Choisissez les informations visibles : état, serveur, type, déploiement, commit et durée. Les informations de déploiement concernent uniquement les applications.
- **Historique déploiements** nécessite une application. Chaque page charge 50 tentatives et le filtre de résultat s’applique à cette page. Changez de page pour remonter dans l’historique. Choisissez présentation, nombre d’éléments et détails visibles. La présentation **Lignes chronologiques** affiche la date à gauche, le résultat à droite et un indicateur coloré. Commit et durée facultatifs occupent une seconde ligne par déploiement et réduisent le nombre de déploiements affichés. Les longs identifiants ne sont plus les titres. Masquez commit/durée pour une colonne étroite. Les dates sont en UTC. Les cartes restent disponibles pour consulter les détails.

Ajoutez plusieurs exemplaires pour juxtaposer une liste des problèmes de production, une application détaillée et ses derniers déploiements. Chaque exemplaire a son titre et sa fréquence d’actualisation (30–3600 secondes). La fraîcheur de l’inventaire dépend également de la fréquence globale ; les réponses de déploiement sont mises en cache 30 secondes. Actualiser démarre une collecte en arrière-plan et avertit les tableaux de bord à la fin. La liste d’états affiche jusqu’à 7 ressources (8 si la date est masquée), les cartes en liste jusqu’à 8 et les grilles jusqu’à 12. La liste d’états utilise des indicateurs colorés dans les deux thèmes et réserve toute la largeur aux noms. Les cartes permettent de consulter le serveur et le type de ressource.

Le sélecteur d’appareils de Gladys 5.1 ne propose pas de listes dépendantes serveur → application, ni de filtrage par type d’appareil. Chaque widget ne demande donc qu’un seul appareil : une ressource pour les détails/l’historique, ou un serveur pour le filtre serveur. L’aide sous le menu explique cette contrainte ; un choix de ressource produit une erreur dans le widget. Le formulaire natif ne permet pas d’afficher une erreur conditionnelle sous un champ. Les menus contiennent les appareils ajoutés à cette intégration. Les choix vides, ressources supprimées et recherches sans résultat sont gérés explicitement.

- **Disponibilité HTTP** affiche le résultat de la dernière sonde, son code HTTP, le temps de réponse, une courbe et le taux de contrôles réussis. Toutes les applications avec un domaine sont surveillées par défaut, même sans widget. Les compteurs, la courbe, les détails et le lien vers l’application sont personnalisables.

## Signification et limites des données

L’API publique expose les états et inventaires, mais pas les mesures CPU, RAM, disque ou réseau de Sentinel. Aucune jauge ou disponibilité en pourcentage n’est inventée. L’état de l’application est celui rapporté par Coolify, pas le résultat d’une sonde HTTP sur son URL. Un service représente sa stack entière, pas chacun de ses conteneurs.

Le widget de ressource distingue **dernière tentative** et **dernier déploiement réussi**. Le dernier succès est recherché parmi les 50 dernières tentatives (repère `¹`). L’absence de succès dans cette fenêtre est indiquée. Une date de fin absente reste indisponible. Le champ `updated_at` d’une ressource n’est jamais interprété comme une date de déploiement. La **durée totale** est `finished_at − created_at`, attente en file comprise ; elle apparaît seulement si les dates existent.

Lors d’un échec de collecte, les widgets affichent l’erreur et la dernière vérification réussie sans présenter d’anciens états verts comme actuels. Les fonctionnalités textuelles des appareils déjà ajoutés conservent leur dernière valeur : vérifiez aussi la connexion de l’intégration. Un token surveille une seule équipe. Changer d’URL d’instance produit de nouveaux identifiants : supprimez les anciens appareils et sélectionnez les nouveaux.

## Appareils et scènes

La collecte de l’inventaire et la vue d’ensemble fonctionnent sans importer d’appareil. L’import sert à rendre un serveur ou une ressource sélectionnable dans les widgets ciblés et à exposer son état textuel dans Gladys. Il ne donne aucun contrôle de démarrage, arrêt ou déploiement. Les déclencheurs dédiés ci-dessous fonctionnent indépendamment de la fonctionnalité textuelle. L’import permet de filtrer une scène sur un appareil précis ; sans filtre, elle reçoit tous les événements de ce type.

## Alertes et contrôles HTTP

Dans **Scènes**, choisissez un déclencheur de l’intégration Coolify : **Ressource indisponible / rétablie**, **Serveur indisponible / rétabli**, ou **Domaine HTTP indisponible / rétabli**. Sélectionnez éventuellement l’appareil, puis ajoutez votre action de notification. Par exemple :

```text
{{triggerEvent.data.name}} est indisponible : {{triggerEvent.data.url}}
Serveur : {{triggerEvent.data.server}}
```

Les variables `status` (état Coolify) ou `http_code` et `response_ms` (sonde HTTP), ainsi que `checked_at`, sont également disponibles selon le déclencheur. Un code ou temps absent reste vide ; le domaine reste vide pour les serveurs, bases et stacks, ou si l’API ne peut pas le fournir.

Le réglage **Contrôles consécutifs avant un événement** vaut 2 par défaut. L’événement n’est émis qu’une fois par transition confirmée, y compris au rétablissement. Au démarrage ou après modification des paramètres, les premières observations établissent une référence **sans notification**, même si l’application est déjà arrêtée. Il n’y a pas de rappel périodique. Un état inconnu ou une collecte API échouée interrompt la série de confirmations et ne déclare pas toutes les applications en panne. L’état Coolify « en marche » est considéré disponible ; les autres états connus sont indisponibles. Les états Coolify suivent la collecte configurée. Les sondes HTTP passent toutes les 5 minutes, indépendamment de cette collecte et de l’actualisation des widgets. Avec deux confirmations, une nouvelle panne HTTP est généralement signalée sous 5 à 10 minutes, hors délais de requêtes.

La **Surveillance HTTP** est réglée par défaut sur **Toutes les applications (automatique)**. Toutes les applications découvertes avec un domaine HTTP valide sont surveillées, y compris celles ajoutées ensuite dans Coolify. Aucun appareil à importer, aucune case à cocher ni widget n’est nécessaire. La limite de 20 applications du mode manuel ne s’applique pas au mode automatique. Les sondes sont limitées à quatre requêtes simultanées ; une grosse instance ou des réponses lentes peuvent allonger un cycle.

Pour afficher les mesures, ajoutez l’application depuis **Découverte**, puis sélectionnez-la dans un widget **Disponibilité HTTP**. La surveillance continue lorsque le tableau de bord est fermé. Plusieurs widgets d’une même application partagent les mesures.

Pour limiter les sondes, choisissez **Sélection manuelle**, puis cochez jusqu’à 20 applications dans **Applications — uniquement en mode manuel**. Cette liste est ignorée en mode automatique : inutile de cocher toutes ses cases. En mode manuel, l’option du widget **Ajouter l’application en mode manuel** peut compléter la sélection. Pour arrêter une application, désactivez cette option ou supprimez ses widgets, puis décochez-la. Le mode **Désactivée** arrête toutes les sondes HTTP ; un widget ne peut pas les réactiver. Les états et déclencheurs Coolify restent disponibles.

Les serveurs, bases et stacks de services ne sont pas sondés. Une application sans domaine n’est pas considérée en panne ; son domaine sera revérifié lors d’un cycle suivant. Le premier domaine HTTP(S) valide du champ `fqdn` est utilisé ; les domaines Compose ne sont pas déduits. Le port de ce champ désigne le conteneur dans Coolify : il est retiré pour joindre le proxy public. Le chemin est conservé. Les modifications de domaine sont relues au plus toutes les cinq minutes ; Actualiser vide ce cache.

Les sondes sont des GET depuis le conteneur Gladys, avec vérification TLS, sans token API ni authentification applicative. Elles s’arrêtent après réception des en-têtes sans télécharger le corps. Le délai maximal est de 5 secondes par défaut. Les codes **200–399** sont acceptés ; personnalisez-les, par exemple `200-399,401` pour accepter une page protégée. Les redirections ne sont pas suivies : un 302 accepté indique que le point d’entrée répond, sans vérifier sa destination. Un 4xx/5xx non accepté, une erreur réseau/TLS ou une expiration est un échec HTTP, distinct de l’état Coolify.

Dans **Période et graphique**, choisissez **24 heures**, **7 jours** ou **30 jours**, avec une courbe remplie ou simple. La période s’applique aux statistiques et au graphique. Les contrôles passent toutes les **5 minutes** ; Actualiser relit l’affichage et l’inventaire sans lancer de sonde supplémentaire.

Les mesures sont conservées **sur disque pendant 30 jours glissants**, puis purgées automatiquement. Elles survivent aux redémarrages, mises à jour et renouvellements de token. L’historique commence à l’activation : les périodes passées ne sont pas reconstituées. Changer d’instance, de domaine ou de codes HTTP acceptés utilise une série distincte, pour ne pas mélanger des mesures incompatibles. Désinstaller l’intégration supprime son dossier de données.

Les compteurs et le taux de contrôles réussis utilisent **toutes les mesures de la période**. Le graphique regroupe les temps de réponse par **5 minutes / 1 heure / 3 heures**, soit au maximum **288 / 168 / 240 points**. Les vues 7 et 30 jours affichent des moyennes. Les repères rouges indiquent le nombre d’échecs dans les huit dernières tranches concernées ; tous les échecs restent comptés dans les statistiques.

Le pourcentage est un taux de contrôles réussis, pas une disponibilité continue garantie. Les périodes sans surveillance ne sont comptées ni comme réussites ni comme échecs. Le temps mesure l’attente des en-têtes ; les expirations n’inventent pas de durée ni de point nul. Les temps manquants et interruptions de collecte utilisent des barres pour éviter de tracer une courbe continue. Le dernier résultat est signalé comme ancien au-delà de dix minutes. Si l’historique est illisible ou ne peut pas être écrit, le widget affiche un avertissement et les contrôles continuent en mémoire.

Il n’y a pas de surveillance lorsque Gladys est arrêté, et une collecte Coolify en erreur suspend les nouvelles sondes jusqu’au rétablissement. Les mesures CPU/RAM nécessiteraient une autre source de télémétrie : la route publique Sentinel donne ses paramètres, pas ses échantillons.

## Dépannage

Si votre tableau de bord contient un ancien widget **Surveillance serveur**, remplacez-le par **Vue d’ensemble** et sélectionnez le même serveur. Les appareils et les scènes ne changent pas.

401 : renouvelez le token et vérifiez son équipe. 403 : vérifiez `read`, l’activation de l’API et les IP autorisées. 404 : actualisez la découverte et vérifiez l’existence de la ressource. 429 : l’intégration respecte `Retry-After` puis réessaie automatiquement. Erreur réseau/TLS : contrôlez le DNS, l’URL accessible depuis le conteneur et la chaîne de certificats. L’inventaire est atomique : un endpoint de ressources inaccessible rend l’instantané indisponible jusqu’à la prochaine collecte réussie.

L’historique HTTP est stocké dans le dossier de données persistant de l’intégration, sans token ni URL en clair. Les caches d’inventaire et de déploiements restent en mémoire. Elle accepte jusqu’à 2000 serveurs et ressources cumulés, limite de Gladys. Les requêtes expirent après 8 secondes, les réponses sont limitées à 4 Mio et la collecte utilise au maximum quatre requêtes simultanées.
