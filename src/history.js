import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export const HTTP_INTERVAL = 5 * 60 * 1000;
export const RETENTION = 30 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const dayName = (at) => new Date(at).toISOString().slice(0, 10);

// Neither credentials nor domains are written to the journal. Different instances,
// applications, domains and accepted-code policies never share a measurement series.
export const historyKey = (config, resource, url) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        config.url,
        resource.server,
        resource.uuid,
        url,
        [...config.httpCodes].sort((a, b) => a - b),
      ]),
    )
    .digest('hex');

export class HttpHistory {
  constructor({ directory = null, now = Date.now } = {}) {
    this.directory = directory;
    this.now = now;
    this.entries = new Map();
    this.queue = Promise.resolve();
    this.error = false;
  }
  async load() {
    if (!this.loading)
      this.loading = this.read().catch(() => {
        this.error = true;
      });
    await this.loading;
  }
  async read() {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const cutoff = dayName(this.now() - RETENTION);
    for (const file of (await readdir(this.directory)).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) continue;
      const path = join(this.directory, file);
      if (file.slice(0, 10) < cutoff) {
        await unlink(path);
        continue;
      }
      // Stream journals: automatic mode can monitor more than 20 applications.
      const input = createReadStream(path, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      input.on('error', () => {
        this.error = true;
        lines.close();
      });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          try {
            if (line.length > 1024) throw new Error('Invalid record size');
            const [key, at, ok, code, ms] = JSON.parse(line);
            if (
              !/^[a-f0-9]{64}$/.test(key) ||
              !Number.isFinite(at) ||
              typeof ok !== 'boolean' ||
              !(code === null || (Number.isInteger(code) && code >= 100 && code <= 599)) ||
              !(ms === null || (Number.isFinite(ms) && ms >= 0))
            )
              throw new Error('Invalid record');
            if (at <= this.now() && at > this.now() - RETENTION) {
              const samples = this.entries.get(key) || [];
              if (!samples.length || at > samples.at(-1).at) samples.push({ at, ok, code, ms });
              this.entries.set(key, samples);
            }
          } catch {
            this.error = true;
          }
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
    this.prunedDay = dayName(this.now());
  }
  samples(key, now = this.now()) {
    const samples = (this.entries.get(key) || []).filter(
      (sample) => sample.at > now - RETENTION && sample.at <= now,
    );
    if (samples.length) this.entries.set(key, samples);
    else this.entries.delete(key);
    return samples;
  }
  async record(key, sample) {
    await this.load();
    const samples = this.samples(key, sample.at);
    // A restarted process must not duplicate an already recorded sample.
    if (samples.at(-1)?.at >= sample.at) return samples;
    samples.push(sample);
    this.entries.set(key, samples);
    this.queue = this.queue
      .then(async () => {
        if (!this.directory) return;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        // A leading newline isolates any truncated final record after a crash.
        await appendFile(
          join(this.directory, `${dayName(sample.at)}.jsonl`),
          `\n${JSON.stringify([key, sample.at, sample.ok, sample.code, sample.ms])}\n`,
          { mode: 0o600 },
        );
        await this.pruneFiles();
      })
      .catch(() => {
        this.error = true;
      });
    await this.queue;
    return samples;
  }
  async pruneFiles() {
    if (this.prunedDay === dayName(this.now())) return;
    if (this.directory) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const file of await readdir(this.directory)) {
        if (
          /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) &&
          file.slice(0, 10) < dayName(this.now() - RETENTION)
        )
          await unlink(join(this.directory, file));
      }
    }
    for (const key of this.entries.keys()) this.samples(key);
    this.prunedDay = dayName(this.now());
  }
  async prune() {
    if (this.prunedDay === dayName(this.now())) return;
    this.queue = this.queue
      .then(() => this.pruneFiles())
      .catch(() => {
        this.error = true;
      });
    await this.queue;
  }
  async flush() {
    await this.queue;
  }
}

export function historyView(samples, selection = 'area', now = Date.now()) {
  const days = selection.endsWith('_30d') ? 30 : selection.endsWith('_7d') ? 7 : 1;
  const width = days === 30 ? 3 * 60 * 60 * 1000 : days === 7 ? 60 * 60 * 1000 : HTTP_INTERVAL;
  const start = now - days * DAY;
  const selected = samples.filter((sample) => sample.at > start && sample.at <= now);
  const buckets = new Map();
  for (const sample of selected) {
    // Anchor the buckets to the requested window: exactly 288/168/240 at most.
    const index = Math.min(
      Math.ceil((days * DAY) / width) - 1,
      Math.ceil((sample.at - start) / width) - 1,
    );
    const bucket = buckets.get(index) || { at: sample.at, sum: 0, count: 0, failures: 0, total: 0 };
    bucket.at = sample.at;
    bucket.total++;
    if (!sample.ok) bucket.failures++;
    if (sample.ms !== null) {
      bucket.sum += sample.ms;
      bucket.count++;
    }
    buckets.set(index, bucket);
  }
  return {
    days,
    width,
    samples: selected,
    buckets: [...buckets.values()],
    gaps: selected.some(
      (sample, i) =>
        sample.ms === null || (i > 0 && sample.at - selected[i - 1].at > HTTP_INTERVAL * 1.5),
    ),
  };
}
