import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DataPaths {
  root: string;
  flows: string;
  runs: string;
  datasets: string;
  sessions: string;
  settings: string;
  schedules: string;
  sessionsIndex: string;
}

export function makePaths(root: string): DataPaths {
  const p: DataPaths = {
    root,
    flows: join(root, 'flows'),
    runs: join(root, 'runs'),
    datasets: join(root, 'datasets'),
    sessions: join(root, 'sessions'),
    settings: join(root, 'settings.json'),
    schedules: join(root, 'schedules.json'),
    sessionsIndex: join(root, 'sessions', 'index.json'),
  };
  for (const d of [p.root, p.flows, p.runs, p.datasets, p.sessions]) mkdirSync(d, { recursive: true });
  return p;
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Writes through a temp file so a crash never leaves half a document. On Windows the rename
 * fails with EPERM/EBUSY while antivirus or the indexer holds the target open, so retry briefly
 * and finally fall back to writing in place.
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 1);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e;
      pause(40 * (attempt + 1));
    }
  }
  writeFileSync(file, text, 'utf8');
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* ignore */
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    // Keep a copy of a corrupt file so nothing is silently lost.
    try {
      if (existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return fallback;
  }
}

/** A directory of `<id>.json` documents with an in-memory cache. */
export class Collection<T extends { id: string }> {
  private cache = new Map<string, T>();
  private loaded = false;

  constructor(
    readonly dir: string,
    private migrate?: (raw: T) => T,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    return join(this.dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
  }

  load(): T[] {
    if (!this.loaded) {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith('.json')) continue;
        const item = readJson<T | null>(join(this.dir, name), null);
        if (item && typeof item === 'object' && 'id' in item) this.cache.set(item.id, this.migrate ? this.migrate(item) : item);
      }
      this.loaded = true;
    }
    return [...this.cache.values()];
  }

  get(id: string): T | undefined {
    this.load();
    return this.cache.get(id);
  }

  put(item: T): T {
    this.load();
    this.cache.set(item.id, item);
    writeJsonAtomic(this.file(item.id), item);
    return item;
  }

  /** Updates the cache now and writes to disk later; use for hot paths like live runs. */
  putCached(item: T): void {
    this.load();
    this.cache.set(item.id, item);
  }

  flush(id: string): void {
    const item = this.cache.get(id);
    if (item) writeJsonAtomic(this.file(item.id), item);
  }

  remove(id: string): void {
    this.load();
    this.cache.delete(id);
    try {
      rmSync(this.file(id), { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** A single JSON document. */
export class Doc<T> {
  private value: T;

  constructor(
    private file: string,
    fallback: T,
    normalize?: (v: T) => T,
  ) {
    const raw = readJson<T>(file, fallback);
    this.value = normalize ? normalize(raw) : raw;
  }

  get(): T {
    return this.value;
  }

  set(v: T): T {
    this.value = v;
    writeJsonAtomic(this.file, v);
    return v;
  }

  /** Replace the in-memory value without writing it yet. */
  setCached(v: T): void {
    this.value = v;
  }
}
