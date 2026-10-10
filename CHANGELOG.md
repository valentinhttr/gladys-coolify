# Changelog

## 1.0.0

### Features

- Add read-only Coolify monitoring with Gladys SDK 0.14.0.
- Provide four configurable widgets: instance/server overview, application/resource details, deployment history and HTTP availability.
- Support English and French settings, widgets and setup guides.
- Include an integration cover featuring the official Coolify logo.
- Discover servers, applications, standalone databases and service stacks, with optional device import.
- Offer colored status lists, detailed cards and automatic server selection for resource widgets.
- Display deployment attempts, successful deployments, commit references and total duration.
- Add debounced outage/recovery scene triggers with application URL variables.
- Monitor all Coolify applications with valid HTTP domains automatically, including newly discovered applications, with optional manual and disabled modes.
- Persist 30 days of HTTP history across restarts and updates, with checks every five minutes.
- Offer 24-hour, 7-day and 30-day response-time charts with exact period statistics and failure markers.
- Show readable deployment rows with dates, commits, durations and aligned results.
- Handle connection errors, token rotation and API rate limits.
- Publish container images for AMD64 and ARM64.

### Contributors

- [Valentin Hutter](https://github.com/valentinhttr)
