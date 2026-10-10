import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseCommit(commit) {
  const match =
    /^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(
      commit.subject,
    );
  return {
    ...commit,
    type: match?.[1] || 'other',
    scope: match?.[2],
    description: match?.[4] || commit.subject,
    breaking: !!match?.[3] || /^BREAKING[ -]CHANGE: /m.test(commit.body || ''),
  };
}
export function nextVersion(previous, commits) {
  if (!previous) return '1.0.0';
  const [major, minor, patch] = previous.replace(/^v/, '').split('.').map(Number);
  if (commits.some((commit) => commit.breaking)) return `${major + 1}.0.0`;
  if (commits.some((commit) => commit.type === 'feat')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
const groups = {
  feat: 'Features',
  fix: 'Bug fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  build: 'Build',
  ci: 'Continuous integration',
  chore: 'Maintenance',
  style: 'Code style',
  revert: 'Reverts',
  other: 'Other changes',
};
const safe = (value) =>
  String(value)
    .replace(/[\r\n<>]/g, ' ')
    .replace(/([[\]`*_])/g, '\\$1');
export function releaseNotes(version, commits, repository, previous) {
  const lines = [`## ${version}`, ''];
  if (commits.some((c) => c.breaking))
    lines.push(
      '### Breaking changes',
      '',
      ...commits.filter((c) => c.breaking).map((c) => `- ${safe(c.description)}`),
      '',
    );
  for (const [type, title] of Object.entries(groups)) {
    const changes = commits.filter((c) => c.type === type);
    if (changes.length)
      lines.push(
        `### ${title}`,
        '',
        ...changes.map(
          (c) =>
            `- ${c.scope ? `**${safe(c.scope)}:** ` : ''}${safe(c.description)} ([${c.hash.slice(0, 7)}](https://github.com/${repository}/commit/${c.hash}))`,
        ),
        '',
      );
  }
  lines.push(
    '### Contributors',
    '',
    ...Array.from(new Set(commits.map((c) => c.author)))
      .sort()
      .map((author) => `- ${safe(author)}`),
    '',
  );
  if (previous)
    lines.push(
      `[Full changelog](https://github.com/${repository}/compare/${previous}...v${version})`,
      '',
    );
  return lines.join('\n');
}

export function prepareRelease() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Release requires a clean working tree');
  const previous = git('tag', '--list', 'v[0-9]*', '--sort=-v:refname')
    .split('\n')
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const log = git(
    'log',
    ...(previous ? [`${previous}..HEAD`] : []),
    '--format=%H%x1f%an%x1f%s%x1f%b%x1e',
  );
  const commits = log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, author, subject, body] = record.split('\x1f');
      return parseCommit({ hash, author, subject, body });
    })
    .filter((c) => !/^chore\(release\):/.test(c.subject));
  if (!commits.length) throw new Error('No changes to release');
  const version = nextVersion(previous, commits);
  const repository = process.env.GITHUB_REPOSITORY || 'valentinhttr/gladys-coolify';
  const notes = releaseNotes(version, commits, repository, previous);
  for (const file of ['package.json', 'package-lock.json', 'gladys-assistant-integration.json']) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    if (file === 'gladys-assistant-integration.json')
      data.docker_image = `ghcr.io/${repository.toLowerCase()}:${version}`;
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  }
  const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/^# Changelog\s*/, '');
  writeFileSync('CHANGELOG.md', `# Changelog\n\n${notes}\n${changelog}`);
  writeFileSync('release-notes.md', notes);
  process.stdout.write(version + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) prepareRelease();
