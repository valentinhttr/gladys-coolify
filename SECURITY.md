# Security

Report vulnerabilities privately through this repository's GitHub security advisory feature, when enabled. Do not put API tokens, private URLs or logs containing credentials in public issues.

This integration requires only Coolify `read` permission. It never intentionally writes to Coolify. Tokens live in Gladys' secret configuration and process memory, not in widget settings, files or logs. Use HTTPS outside a trusted local network. TLS verification cannot be disabled, and authenticated redirects are rejected. Gladys' widget payloads can be visible on shared dashboards: choose displayed resource names accordingly.
