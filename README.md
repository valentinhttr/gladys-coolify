# Coolify for Gladys Assistant

Monitor your Coolify servers, applications and deployments directly from your Gladys dashboard.

**English and French** · **Gladys 5.1.0+** · **Read-only access**

[English guide](docs/en.md) · [Guide français](docs/fr.md)

## Your Coolify dashboard

| Widget                     | What you can monitor                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| **Instance overview**      | All servers or one selected server: availability, counts and filtered resources.      |
| **Application / resource** | Current state, latest deployment attempt, last successful deployment and Git commit.  |
| **HTTP availability**      | Optional domain checks, response-time chart and success rate of recent checks.        |
| **Deployment history**     | Deployment results, dates, commits and total duration, with access to older attempts. |

Add multiple copies of each widget to create the dashboard you need. Each has independent settings: choose the server or resource, visible details, title and refresh interval. Inventory widgets offer a colored status list or detailed cards; history offers list or grid layouts. Each has a configurable item count.

## Installation

1. Download the [integration manifest](https://github.com/valentinhttr/gladys-coolify/releases/latest/download/gladys-assistant-integration.json).
2. In Gladys, open **Integrations → Install an integration → Developer mode** and paste the manifest.
3. Enter your **Coolify instance URL** and **API token** in the integration settings.
4. Click **Test connection and discover**, then add the servers and resources you want from **Discovery**.
5. Add Coolify widgets to your dashboard and select the devices to monitor.

The instance overview works immediately, without adding devices.

## Connect to Coolify

In Coolify, select the team you want to monitor, then open **Keys & Tokens → API tokens → Create New Token**. Enable **only `read`**.

For a self-hosted instance, enable API access in **Settings**. If an IP allowlist is configured, allow the address used by Gladys to reach Coolify. Use your instance URL, for example `https://coolify.example.com`.

The integration monitors your resources without starting, stopping or redeploying them. Token setup instructions are also available directly in Gladys.

## Monitoring and notifications

Create Gladys scenes using Coolify’s **Resource unavailable/recovered**, **Server unavailable/recovered** or **HTTP endpoint unavailable/recovered** triggers, then add your notification action. Events fire once per confirmed transition, with the resource name, server and application URL available as scene variables.

**All Coolify applications with a valid HTTP domain are monitored automatically**, including newly discovered applications. No checkbox, device import or widget is needed to start monitoring. Add an **HTTP availability** widget and select an imported application to view its measurements. In **Configuration → HTTP monitoring**, choose **Manual selection** to restrict monitoring or **Disabled** to stop HTTP probes. The application checkboxes apply only to manual mode. Checks use the first valid Coolify domain and run without API credentials. HTTP checks run every 5 minutes. Choose a 24-hour, 7-day or 30-day view: statistics use every check in the period, while the chart groups response times for readability. History is kept on disk for 30 days and survives restarts and updates. See the guides for confirmation thresholds, accepted HTTP codes and startup behavior.

## Available data

Server and resource states come from Coolify. Application widgets distinguish the latest deployment attempt from the last successful deployment found among the latest 50 attempts. Total duration includes queue time and is displayed when completion dates are available.

CPU, memory and disk measurements are not exposed by the public Coolify API used by this integration. Select a single resource for application details or deployment history; its server is detected automatically. Server filters accept server devices only.

For configuration details and troubleshooting, see the [English guide](docs/en.md) or [guide français](docs/fr.md).
