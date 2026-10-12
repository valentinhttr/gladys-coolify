# Monitor Coolify in Gladys

Requires Gladys **5.1.0 or later** and a Coolify v4 instance exposing the public `/api/v1` API. The integration uses SDK **0.15.0**. The API surface varies across Coolify releases; unsupported fields remain unavailable rather than being estimated.

## Create a token

1. In Coolify, switch to the **team you want to monitor**. Tokens are bound to that team.
2. Open **Keys & Tokens → API tokens → Create New Token** and name it `Gladys monitoring`.
3. Select **only `read`**. Neither `read:sensitive`, `write`, `deploy` nor `root` is needed. The integration never reads environment variables, private keys or logs, and never starts, stops or deploys anything.
4. On a self-hosted instance, enable API access in **Settings**. If you restrict API source IPs, allow the address from which the Gladys integration container reaches Coolify (possibly the NAT/public address, not the browser address).
5. Copy the token into the integration's **API token** field. Rotate it in Coolify and replace it here when needed.

See [Coolify permissions](https://coolify.io/docs/api/permissions) and [API/IP access](https://coolify.io/docs/api/ip-allowlist).

## Configure and install

Until store discovery is enabled, download the manifest attached to a GitHub release and paste it into **Integrations → Install an integration → Developer mode**. The matching GHCR image must be public. Use the release's manifest so its version matches the image.

Enter your instance URL, e.g. `https://coolify.example.com` (an optional `/api/v1` suffix is accepted), and your token. Use HTTPS for remote connections; plain HTTP is accepted for trusted local installations. TLS verification stays enabled and redirects are rejected: use the final instance URL. From inside the integration container, `localhost` is the integration itself.

Set the inventory polling interval, from 30 to 3600 seconds (default 60), and the naming language for newly discovered devices. Save, then press **Test connection and discover**. The connection indicator reports Coolify access independently of the Gladys connection.

Coolify inventory is discovered automatically. In **Discovery**, add only the servers and resources you want to select in widgets or use as Gladys devices. Importing every application is unnecessary. Server names begin with `Server` or `Serveur`; resource names follow `Server name · Resource name`. Existing devices keep user-chosen names. Their read-only text feature reports status in the configured device language. Widget content follows each viewer's English/French language automatically.

## Build your dashboard

- **Instance overview** combines instance and server monitoring. Leave **Server (optional)** empty for all servers, without importing devices. Select a Server device to show its name, availability and only its resources. Selecting an application as a server produces an explicit error. Filter further by resource type, status and name. Counts apply to the filtered set. Choose alphabetical ordering or issues first.
- **Application / resource** requires only a resource; its server is detected automatically. Choose exactly which details to show: state, server, type, deployment, commit and duration. Deployment information applies only to applications.
- **Deployment history** requires an application. Each history page loads 50 attempts; outcome filtering happens within that page. Change page to inspect older attempts. Choose list/grid, visible items and details. **Chronological rows** put dates on the left and results on the right, with colored indicators. Optional commit and duration details occupy a second row per deployment and reduce the number of visible deployments. Long identifiers no longer serve as titles. Hide commit/duration in narrow columns. All dates use UTC. Detailed cards remain available.

Repeat widgets to create, for example, a production error list alongside a detailed application and its deployment history. Each copy has its own title and refresh interval (30–3600 seconds). Inventory freshness is bounded by the global polling interval; deployment responses are cached for 30 seconds. Refresh starts background collection and nudges dashboards when it finishes. Status lists show up to 7 resources (8 with check time hidden), card lists up to 8 and grids up to 12. Status lists use colored indicators in both themes and give names the full row width. Cards let you inspect the hosting server and resource type.

Gladys 5.1's device selector does not support cascading server/application options or filtering device types. Each widget therefore asks for just one device: a resource for details/history, or a server for the server filter. Help below the menu explains this restriction; choosing a resource produces an error inside the widget. The native form cannot show a conditional field-level error. Menus show devices imported into this integration. Empty selections, deleted resources and no matching results are handled explicitly.

- **HTTP availability** shows the latest probe result, HTTP code, response time, a chart and recent check success rate. All applications with a domain are monitored by default, even without a widget. Counters, chart, details and the application link are customizable.

## What the data means

The public API exposes server status and resource inventories, not Sentinel CPU, RAM, disk or network measurements. No fabricated gauges or availability percentages are shown. Resource state comes from Coolify, not an HTTP health probe of your application's URL. A service represents its stack, not each child container.

The resource widget separates **latest attempt** from **last successful deployment**. The last success is searched within the latest 50 attempts (the `¹` marker). If no success exists in that window, it says so. Missing completion dates remain unavailable. A resource's `updated_at` is never used as a deployment date. **Total duration** is `finished_at − created_at`, including queue time, and appears only when those dates are available.

If a refresh fails, widgets show the error and last successful check instead of presenting old green statuses as current. Previously imported status features retain their last recorded value; check integration connectivity before relying on those separate features. One token monitors one team. Changing instance URL produces different device IDs; remove old devices and reselect the new ones.

## Devices and scenes

Inventory collection and the instance overview work without importing devices. Importing makes a server or resource selectable in targeted widgets and exposes its read-only text status in Gladys. It provides no start, stop or deployment controls. Dedicated triggers below work independently of the text feature. Importing lets you filter a scene by a particular device; leaving the filter empty receives all events of that type.

## Alerts and HTTP checks

In **Scenes**, choose a Coolify trigger: **Resource unavailable/recovered**, **Server unavailable/recovered**, or **HTTP endpoint unavailable/recovered**. Optionally select a device, then add your notification action. Example message:

```text
{{triggerEvent.data.name}} is unavailable: {{triggerEvent.data.url}}
Server: {{triggerEvent.data.server}}
```

The variables `status` (Coolify status) or `http_code` and `response_ms` (HTTP probes), plus `checked_at`, are available depending on the trigger. Missing codes/timings stay empty. The URL is empty for servers, databases and stacks, or when the API cannot provide it.

**Consecutive checks before an event** defaults to 2. An event fires once per confirmed transition, including recovery. Startup and configuration changes establish a **silent baseline**, even if the application is already down. There are no periodic reminder events. Unknown readings and failed API collections break the confirmation sequence instead of declaring every application down. Coolify’s running status counts as available; other known states count as unavailable. Coolify states follow the configured inventory interval. HTTP probes run every 5 minutes, independently of inventory and widget refresh. With two confirmations, a new HTTP outage is usually detected within 5–10 minutes, plus request processing time.

**HTTP monitoring** defaults to **All applications (automatic)**. Every discovered application with a valid HTTP domain is monitored, including applications added later in Coolify. No device import, checkbox selection or widget is needed. The manual mode’s 20-application limit does not apply to automatic mode. Probes use at most four concurrent requests; a large instance or slow responses can extend a cycle.

To display measurements, import the application from **Discovery**, then select it in an **HTTP availability** widget. Monitoring continues with the dashboard closed. Multiple widgets for the same application share measurements.

To limit probes, choose **Manual selection**, then select up to 20 applications under **Applications — manual mode only**. Automatic mode ignores this list: there is no need to check every box. In manual mode, a widget’s **Add application in manual mode** option can extend the selection. To stop an application, disable that option or remove its widgets, then deselect it. **Disabled** stops all HTTP probes; a widget cannot re-enable them. Coolify state monitoring and triggers remain available.

Servers, databases and service stacks are not probed. An application without a domain is not considered down; its domain is checked again on a later cycle. The first valid HTTP(S) domain in `fqdn` is used; Compose domains are not inferred. A port in this Coolify field targets the container, so it is removed when checking the public proxy. The path is preserved. Domain metadata is refreshed at most every five minutes; Refresh clears that cache.

Probes issue GET requests from the Gladys integration container with TLS validation, without the API token or application credentials. They stop after receiving headers, cancelling the response body. Timeout defaults to 5 seconds. Codes **200–399** count as success; customize this, e.g. `200-399,401` for a protected endpoint. Redirects are not followed: an accepted 302 proves the entry point responds, not that its destination is healthy. An unaccepted 4xx/5xx, network/TLS error or timeout is an HTTP failure independent of Coolify’s state.

In **Period and chart**, choose **24 hours**, **7 days** or **30 days**, with a filled curve or plain line. The period applies to both statistics and the chart. Probes run every **5 minutes**; Refresh reloads the display and inventory without adding an extra probe.

Measurements are kept **on disk for a rolling 30 days**, then purged automatically. They survive restarts, updates and token rotation. History begins at activation; earlier periods cannot be reconstructed. Changing the instance, domain or accepted HTTP codes uses a separate series so incompatible measurements are not mixed. Uninstalling the integration removes its data folder.

Counters and success rates use **every measurement in the selected period**. The chart groups response times into **5-minute / 1-hour / 3-hour intervals**, with at most **288 / 168 / 240 points**. The 7-day and 30-day views show averages. Red markers show failure counts in the latest eight affected intervals; every failure remains included in the statistics.

The percentage is a check success rate, not guaranteed continuous uptime. Unmonitored periods count as neither success nor failure. Response time measures time to headers; timeouts do not invent a duration or a zero point. Missing timings and collection gaps use separate bars instead of a continuous curve. Results older than ten minutes are marked outdated. If history cannot be read or written, the widget displays a warning and live checks continue in memory.

Monitoring cannot run while Gladys is stopped, and a failed Coolify inventory suspends probes until recovery. CPU/RAM charts would require another telemetry source: the public Sentinel endpoint returns settings, not metric samples.

## Troubleshooting

If your dashboard contains an older **Server monitor** widget, replace it with **Instance overview** and select the same server. Devices and scenes are unchanged.

401: replace the expired/revoked token and verify its team. 403: check `read`, enabled API access and the IP allowlist. 404: refresh discovery and verify that the resource still exists. 429: the integration waits for `Retry-After`, then retries automatically. Network/TLS errors: check DNS, the URL visible from the container and the certificate chain. Inventory is collected atomically; an inaccessible server resource endpoint makes the snapshot unavailable until the next successful collection.

HTTP history is stored in the integration’s persistent data folder, without tokens or plain-text URLs. Snapshot and deployment caches remain in memory. Discovery supports up to 2000 combined servers/resources, matching Gladys' limit. Requests have an 8-second timeout, a 4 MiB response limit and at most four concurrent inventory requests.
