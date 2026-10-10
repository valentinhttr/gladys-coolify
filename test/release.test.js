import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit, nextVersion, releaseNotes } from '../scripts/release.mjs';
const commit = (subject, body = '') =>
  parseCommit({ subject, body, hash: '1234567890', author: 'Valentin Hutter' });
test('semantic version follows features, fixes and breaking markers', () => {
  assert.equal(nextVersion(undefined, [commit('feat: initial integration')]), '1.0.0');
  assert.equal(nextVersion('v1.2.3', [commit('fix: repair API parsing')]), '1.2.4');
  assert.equal(nextVersion('v1.2.3', [commit('feat(widgets): add filters')]), '1.3.0');
  assert.equal(nextVersion('v1.2.3', [commit('feat!: change settings')]), '2.0.0');
  assert.equal(
    nextVersion('v1.2.3', [commit('refactor: change contract', 'BREAKING CHANGE: removed field')]),
    '2.0.0',
  );
});
test('English notes group changes, link commits and list unique contributors', () => {
  const notes = releaseNotes(
    '1.1.0',
    [commit('feat(widgets): add filters'), commit('fix: fix state')],
    'valentinhttr/gladys-coolify',
    'v1.0.0',
  );
  assert.match(notes, /### Features/);
  assert.match(notes, /### Bug fixes/);
  assert.match(notes, /### Contributors/);
  assert.equal(notes.split('Valentin Hutter').length, 2);
  assert.match(notes, /compare\/v1.0.0\.\.\.v1.1.0/);
});
