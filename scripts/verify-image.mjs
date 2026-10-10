import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Verify the public artifact, including what Gladys reads on a forced update.
const repository = process.env.GITHUB_REPOSITORY;
assert.match(repository || '', /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/);
const manifest = JSON.parse(readFileSync('gladys-assistant-integration.json', 'utf8'));
async function json(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `Image verification HTTP ${response.status}`);
  return response.json();
}
const { token } = await json(`https://ghcr.io/token?scope=repository:${repository}:pull`);
const registry = (path) =>
  json(`https://ghcr.io/v2/${repository}/${path}`, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json',
  });
const index = await registry(`manifests/${manifest.version}`);
const architectures = [];
for (const item of index.manifests) {
  if (item.platform?.os !== 'linux') continue;
  const image = await registry(`manifests/${item.digest}`);
  const config = await registry(`blobs/${image.config.digest}`);
  assert.equal(config.config.User, 'node');
  assert.equal(
    config.config.Labels['org.opencontainers.image.revision'],
    process.env.IMAGE_REVISION,
  );
  assert.deepEqual(JSON.parse(config.config.Labels['io.gladysassistant.manifest']), manifest);
  architectures.push(item.platform.architecture);
}
assert.deepEqual(architectures.sort(), ['amd64', 'arm64']);
console.log('Anonymous AMD64/ARM64 images, revision and embedded manifest verified.');
