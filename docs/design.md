# Widget and API decisions

Research date: 2026-10-10. The interface extends Gladys' native declarative widget system; there is no independent visual theme or frontend runtime.

## Useful monitoring signals

| Signal                          | Source                                                                     | Decision                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Server availability             | `GET /servers`, `is_reachable` / `is_usable` (including settings fallback) | Show ready, unreachable, unusable or unknown; missing values never mean ready                       |
| Applications, databases, stacks | `GET /servers/{uuid}/resources`                                            | Explicit server membership, avoid guessing relationships from internal numeric IDs                  |
| Current resource state          | Resource `status`                                                          | Distinguish `running:unhealthy` from running before checking prefixes                               |
| Latest deployment attempt       | `GET /deployments/applications/{uuid}?skip=N&take=50`                      | Per-application, newest first, paged; `/deployments` lists ongoing work and is not an audit history |
| Last successful deployment      | `finished` entry within latest 50 attempts                                 | Separate from last attempt; never derive from resource `updated_at`                                 |
| Total deployment duration       | `finished_at − created_at`                                                 | Includes queue time, omitted if timestamps unavailable                                              |
| CPU, RAM, disk, bandwidth       | No public GET metrics route in the examined API                            | Do not expose fake zero values or Sentinel's internal UI endpoints                                  |
| Logs, credentials, environment  | Sensitive endpoints                                                        | Unnecessary for dashboard monitoring; read-only token suffices                                      |
| Restart / redeploy              | Mutating endpoints                                                         | Outside monitoring scope; keeps the required permission at `read`                                   |

The unified overview uses an optional server filter: no selection shows fleet readiness, while a selected server supplies the title, availability and resource scope. SDK 0.14.0 has no hidden widget aliases or dashboard migration API; older `server` widgets must be replaced by `overview` with the same server setting. The four widgets answer these questions: “What needs attention?”, “What is on this server?”, “Is this application running?”, and “What happened during deployment?”. Each can be repeated and customized independently. The native 10-setting and 8-component budgets constrain arbitrary layouts; personalization is supported within those documented limits. A resource determines its own server. Server filters require a server device and explicitly reject resources. Dependent select menus require a future Gladys core capability.

## Native selection and presentation

The core resolves `source: devices` to imported `device.external_id` values, without type filtering or integration-defined inline field validation. It rejects widget setting strings longer than 100 characters before calling the integration. Resource IDs that exceed this bound use a deterministic 24-character SHA-256 prefix over instance URL, type, server and UUID. Short existing IDs are preserved, and older imported IDs continue to receive state updates. Old oversized IDs must be replaced through Discovery to be usable in widget settings.

Inventory defaults to a native status list: colored dots retain semantic meaning in light and dark themes, unlike the native card badges whose dark-mode foreground is neutralized by Gladys. Status text accompanies color. Cards remain an explicit optional layout, with the core’s styling limitations. All rendering uses native SDK components; no injected CSS or custom frontend.

## Monitoring signals and HTTP statistics

Scene declarations use SDK 0.14.0 `publishSceneEvent`, with separate outage/recovery keys for servers, resources and HTTP endpoints. Debounce known states, establish silent baselines after configuration, break sequences on unknown observations, and never equate an API outage with application outages. Events expose only declared scalar fields, use the actual imported device external ID, and do not retry ambiguous delivery. Up to 80 Coolify transitions are emitted per cycle, followed by HTTP transitions within a shared limit of 100 events. Transitions beyond the budget are left uncommitted for later observations, rather than silently losing their notification.

HTTP mode defaults to `all`, including for existing configurations with no `http_mode`. It targets every discovered application independently of imported devices and widget views; absent/invalid domains are skipped, never marked down. The `off` mode takes precedence over widgets. In `manual` mode, the first HTTP widget read enrolls its imported application through SDK `setConfig` (partial merge, no echo), unless `auto_monitor` is disabled. Serialize enrollments, retain the existing selection and statistics, persist before probing, and report capacity/save errors. Immediate first probes only sample the newly enrolled application so they do not advance unrelated alert confirmations. No widget lifecycle/listing API exists in SDK 0.14.0: deleting a widget does not unenroll the application. Selection persists; measurements are also journaled on disk. Probes run in a separate background task, at most four at once, for all applications in automatic mode or up to 20 selected applications in manual mode. Read `GET /applications/{uuid}` for `fqdn`, cache metadata for five minutes and retain only a validated URL in monitoring data. Remove the container target port per Coolify domain semantics. GET without credentials, manual redirects, TLS validation and timeout; cancel response bodies immediately. Domain lookup failures are unknown, not down. Keep a rolling 30-day history; show success fraction, time-to-headers and its curve, never claim SLA uptime or fabricated CPU metrics. Generation checks and abort signals discard old work after config changes.

## Reliability and privacy

Collect inventory in the background with four workers. Widgets never wait for a whole fleet of servers. Cache per-application history briefly and deduplicate identical concurrent requests. Apply a shared API cooldown on 429. Stop and abort old clients on credential changes, discard previous inventory on instance changes, and namespace device IDs by normalized instance URL.

Allowlist safe fields before creating widget/device data; API error bodies and credentials never enter logs or rendered content. API reads use bounded bodies and timeouts with redirects disabled. In case of collection failure, suppress normal current-state widgets and show a clear retry/error state. Zero resources, unknown status and unavailable deployment dates have distinct meanings.

## Verification scope

The test suite validates English/French content for both list and grid through the validator from the **published** SDK 0.14.0, and validates the manifest against the official store schema. That npm release has no `testing` export (the upstream development branch already does), so test doubles replace only the HTTP boundary of the actual SDK. Production depends solely on the pinned published SDK.

Settings were also checked against Gladys' actual server validator with database access replaced by imported-device fixtures. Native widget components and styles were rendered with sample data at 320px and 460px widths in light and dark modes; colored indicators and compact dates were checked. This isolated component preview is not a live test of the user's instance. Live Coolify credentials are not required by the automated suite; a real installation check is still needed for a particular deployed Coolify version.

## Sources

- [Coolify API overview](https://coolify.io/docs/api/overview)
- [Coolify API permissions](https://coolify.io/docs/api/permissions)
- [Coolify API routes](https://github.com/coollabsio/coolify/blob/main/routes/api.php)
- [Server controller](https://github.com/coollabsio/coolify/blob/main/app/Http/Controllers/Api/ServersController.php)
- [Deployment controller](https://github.com/coollabsio/coolify/blob/main/app/Http/Controllers/Api/DeployController.php)
- [Gladys integration development](https://gladysassistant.com/fr/docs/dev/external-integrations/)

## HTTP history and scheduling

`HttpHistory` appends compact records to daily JSONL journals under `/data/http-history` (override with `COOLIFY_DATA_DIR` for local development). Gladys binds `/data` to its persistent integration folder. Each record contains only a SHA-256 series key, timestamp, success flag, status code and response time. Keys isolate instance URL, server/application UUID, domain and accepted-code policy; token rotation preserves history. Journals are streamed on load so a day with many monitored applications is not discarded by a fixed file-size cap. Append operations are serialized, with a leading newline to isolate a truncated crash tail. Read errors and corrupt rows are surfaced in the widget; live monitoring continues. Expired samples are filtered at read time and daily files are purged on the next inventory or probe, even if no HTTP applications are selected. The boundary day file can contain expired rows until the following daily purge; they are never included in statistics.

A separate timer schedules HTTP probes every five minutes; inventory refreshes reuse the due times instead of causing additional requests. Restored last-check times prevent duplicate probes after restart. Startup/configuration still establishes silent alert baselines. Configuration changes discard late asynchronous work through generation checks. A changed domain/code policy starts a distinct series; other historical series age out normally.

`historyView` keeps every selected raw sample for statistics but aggregates charts to 288/168/240 buckets for 24 h/7 d/30 d. Missing timings are excluded from latency averages, included in failure counts, and trigger bars rather than interpolation. At most eight recent failing buckets are annotated; all failures remain in the exact counters. Unknown gaps never become successes or failures. The native ten-setting budget is preserved by extending the existing `chart_type` selector to period/style combinations; previous `area` and `line` settings remain valid as 24-hour views.
