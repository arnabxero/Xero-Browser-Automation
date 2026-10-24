import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RUN_OPTIONS, DEFAULT_SETTINGS, domainOf, newFlow, uid } from '../shared/defaults';
import { isInputStep } from '../shared/steps';
import type { Dataset, DatasetSummary, Flow, FlowSummary, Run, RunSummary, SavedSession, Schedule, Settings } from '../shared/types';
import { Collection, Doc, makePaths, readJson, writeJsonAtomic, type DataPaths } from './store';

function normalizeSettings(s: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    recorder: { ...DEFAULT_SETTINGS.recorder, ...(s.recorder ?? {}) },
    runDefaults: { ...DEFAULT_RUN_OPTIONS, ...(s.runDefaults ?? {}) },
  };
}

function migrateFlow(f: Flow): Flow {
  return { ...f, tags: f.tags ?? [], variables: f.variables ?? [], steps: (f.steps ?? []).map((s) => ({ ...s, enabled: s.enabled !== false })), schemaVersion: 1 };
}

export function flowDomain(f: Flow): string | undefined {
  return domainOf(f.startUrl ?? f.steps.find((s) => s.type === 'navigate')?.url);
}

export function summarizeFlow(f: Flow): FlowSummary {
  const { steps, variables: _vars, ...rest } = f;
  const inputs = steps.filter(isInputStep);
  return {
    ...rest,
    stepCount: steps.length,
    fieldCount: inputs.length,
    randomFieldCount: inputs.filter((s) => s.value?.mode === 'random').length,
    domain: flowDomain(f),
  };
}

export function summarizeRun(r: Run): RunSummary {
  const { iterations, logs: _logs, steps, ...rest } = r;
  const done = iterations.filter((i) => i.duration !== undefined && (i.status === 'passed' || i.status === 'failed'));
  return {
    ...rest,
    stepCount: steps.length,
    avgDuration: done.length ? Math.round(done.reduce((a, i) => a + (i.duration ?? 0), 0) / done.length) : undefined,
  };
}

/** Ids come from the renderer; anything else could point outside the data folder. */
export const SAFE_ID = /^[\w-]{1,80}$/;

function assertId(id: string): string {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('Invalid id');
  return id;
}

/** Run documents can be large, so they live in their own files behind a small index. */
class RunStore {
  private index: Doc<RunSummary[]>;
  private cache = new Map<string, Run>();

  constructor(private dir: string) {
    this.index = new Doc<RunSummary[]>(join(dir, 'index.json'), []);
    this.recoverInterrupted();
  }

  /** Runs that were still going when the app quit or crashed are marked stopped. */
  private recoverInterrupted() {
    const stale = this.index.get().filter((r) => r.status === 'running' || r.status === 'queued' || r.status === 'paused');
    for (const sum of stale) {
      const run = SAFE_ID.test(sum.id) ? readJson<Run | null>(join(this.dir, `${sum.id}.json`), null) : null;
      if (!run) {
        this.index.setCached(this.index.get().filter((r) => r.id !== sum.id));
        continue;
      }
      for (const it of run.iterations) if (it.status === 'running' || it.status === 'pending') it.status = 'stopped';
      run.status = 'stopped';
      run.error = run.error ?? 'Xero was closed while this run was in progress.';
      const t = { total: run.iterations.length, passed: 0, failed: 0, stopped: 0, running: 0, pending: 0 };
      for (const it of run.iterations) t[it.status === 'pending' ? 'pending' : it.status]++;
      run.totals = t;
      this.save(run);
    }
    if (stale.length) this.index.set(this.index.get());
  }

  artifactsDir(id: string) {
    return join(this.dir, assertId(id));
  }

  list(): RunSummary[] {
    return this.index.get();
  }

  get(id: string): Run | null {
    if (!SAFE_ID.test(id)) return null;
    const c = this.cache.get(id);
    if (c) return c;
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) return null;
    const run = readJson<Run | null>(file, null);
    if (run) {
      this.cache.set(id, run);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value as string);
    }
    return run;
  }

  /** Keep the live object in memory; only the index changes. */
  track(run: Run): void {
    this.cache.set(run.id, run);
    this.upsertIndex(summarizeRun(run), false);
  }

  save(run: Run): void {
    this.cache.set(run.id, run);
    writeJsonAtomic(join(this.dir, `${run.id}.json`), run);
    this.upsertIndex(summarizeRun(run), true);
  }

  private upsertIndex(sum: RunSummary, persist: boolean) {
    const list = this.index.get().filter((r) => r.id !== sum.id);
    list.unshift(sum);
    list.sort((a, b) => b.startedAt - a.startedAt);
    if (persist) this.index.set(list);
    else this.index.setCached(list);
  }

  delete(id: string): void {
    assertId(id);
    this.cache.delete(id);
    rmSync(join(this.dir, `${id}.json`), { force: true });
    rmSync(this.artifactsDir(id), { recursive: true, force: true });
    this.index.set(this.index.get().filter((r) => r.id !== id));
  }

  prune(keep: number, isActive: (id: string) => boolean): string[] {
    const list = this.index.get();
    if (list.length <= keep) return [];
    const removed: string[] = [];
    for (const r of list.slice(keep)) {
      if (isActive(r.id)) continue;
      this.delete(r.id);
      removed.push(r.id);
    }
    return removed;
  }
}

export type RepoEvent = 'flows' | 'settings' | 'datasets' | 'schedules' | 'sessions' | 'runs';

export class Repo extends EventEmitter {
  readonly paths: DataPaths;
  private flowsCol: Collection<Flow>;
  private datasetsCol: Collection<Dataset>;
  private settingsDoc: Doc<Settings>;
  private schedulesDoc: Doc<Schedule[]>;
  private sessionsDoc: Doc<SavedSession[]>;
  readonly runs: RunStore;

  constructor(root: string) {
    super();
    this.paths = makePaths(root);
    this.flowsCol = new Collection<Flow>(this.paths.flows, migrateFlow);
    this.datasetsCol = new Collection<Dataset>(this.paths.datasets);
    this.settingsDoc = new Doc<Settings>(this.paths.settings, DEFAULT_SETTINGS, normalizeSettings);
    this.schedulesDoc = new Doc<Schedule[]>(this.paths.schedules, []);
    this.sessionsDoc = new Doc<SavedSession[]>(this.paths.sessionsIndex, []);
    this.runs = new RunStore(this.paths.runs);
  }

  private changed(what: RepoEvent) {
    this.emit('change', what);
  }

  // ── Settings ────────────────────────────────────────────────────────────
  settings(): Settings {
    return this.settingsDoc.get();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const cur = this.settingsDoc.get();
    const next = normalizeSettings({
      ...cur,
      ...patch,
      recorder: { ...cur.recorder, ...(patch.recorder ?? {}) },
      runDefaults: { ...cur.runDefaults, ...(patch.runDefaults ?? {}) },
    });
    this.settingsDoc.set(next);
    this.changed('settings');
    return next;
  }

  // ── Flows ───────────────────────────────────────────────────────────────
  listFlows(): FlowSummary[] {
    return this.flowsCol
      .load()
      .map(summarizeFlow)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getFlow(id: string): Flow | null {
    return this.flowsCol.get(id) ?? null;
  }

  saveFlow(flow: Flow, touch = true): Flow {
    const next = { ...flow, updatedAt: touch ? Date.now() : flow.updatedAt };
    this.flowsCol.put(next);
    this.changed('flows');
    return next;
  }

  createFlow(patch: Partial<Flow> = {}): Flow {
    const f = newFlow(patch);
    this.flowsCol.put(f);
    this.changed('flows');
    return f;
  }

  deleteFlow(id: string): void {
    this.flowsCol.remove(id);
    const schedules = this.schedulesDoc.get();
    if (schedules.some((s) => s.flowId === id)) {
      this.schedulesDoc.set(schedules.filter((s) => s.flowId !== id));
      this.changed('schedules');
    }
    this.changed('flows');
  }

  duplicateFlow(id: string): Flow | null {
    const src = this.getFlow(id);
    if (!src) return null;
    const now = Date.now();
    const copy: Flow = {
      ...structuredClone(src),
      id: uid('f'),
      name: `${src.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      lastRun: undefined,
      runCount: 0,
      steps: src.steps.map((s) => ({ ...structuredClone(s), id: uid('s') })),
    };
    this.flowsCol.put(copy);
    this.changed('flows');
    return copy;
  }

  importFlow(raw: unknown): Flow | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<Flow>;
    if (!Array.isArray(r.steps)) return null;
    const now = Date.now();
    const f: Flow = migrateFlow({
      ...newFlow(),
      ...r,
      id: uid('f'),
      name: r.name || 'Imported flow',
      createdAt: now,
      updatedAt: now,
      lastRun: undefined,
      runCount: 0,
      steps: r.steps.map((s) => ({ ...s, id: uid('s') })),
    } as Flow);
    this.flowsCol.put(f);
    this.changed('flows');
    return f;
  }

  // ── Datasets ────────────────────────────────────────────────────────────
  listDatasets(): DatasetSummary[] {
    return this.datasetsCol
      .load()
      .map(({ rows, ...rest }) => ({ ...rest, rowCount: rows.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getDataset(id: string): Dataset | null {
    return this.datasetsCol.get(id) ?? null;
  }

  saveDataset(ds: Dataset): Dataset {
    const next = { ...ds, updatedAt: Date.now() };
    this.datasetsCol.put(next);
    this.changed('datasets');
    return next;
  }

  deleteDataset(id: string): void {
    this.datasetsCol.remove(id);
    this.changed('datasets');
  }

  // ── Schedules ───────────────────────────────────────────────────────────
  listSchedules(): Schedule[] {
    return this.schedulesDoc.get();
  }

  saveSchedule(s: Schedule): Schedule {
    const list = this.schedulesDoc.get().filter((x) => x.id !== s.id);
    list.push(s);
    list.sort((a, b) => a.createdAt - b.createdAt);
    this.schedulesDoc.set(list);
    this.changed('schedules');
    return s;
  }

  patchSchedule(id: string, patch: Partial<Schedule>): void {
    const list = this.schedulesDoc.get().map((s) => (s.id === id ? { ...s, ...patch } : s));
    this.schedulesDoc.set(list);
    this.changed('schedules');
  }

  deleteSchedule(id: string): void {
    this.schedulesDoc.set(this.schedulesDoc.get().filter((s) => s.id !== id));
    this.changed('schedules');
  }

  // ── Saved browser sessions (cookies + storage) ──────────────────────────
  listSessions(): SavedSession[] {
    return this.sessionsDoc.get();
  }

  sessionFile(id: string): string | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const f = join(this.paths.sessions, `${id}.json`);
    return existsSync(f) ? f : undefined;
  }

  saveSession(name: string, state: { cookies: { domain: string }[]; origins: { origin: string }[] }): SavedSession {
    const id = uid('ss');
    writeJsonAtomic(join(this.paths.sessions, `${id}.json`), state);
    const domains = new Set<string>();
    for (const c of state.cookies) domains.add(c.domain.replace(/^\./, ''));
    for (const o of state.origins) {
      try {
        domains.add(new URL(o.origin).hostname);
      } catch {
        /* ignore */
      }
    }
    const s: SavedSession = { id, name, origins: [...domains].slice(0, 20), cookieCount: state.cookies.length, createdAt: Date.now() };
    this.sessionsDoc.set([s, ...this.sessionsDoc.get()]);
    this.changed('sessions');
    return s;
  }

  renameSession(id: string, name: string): void {
    assertId(id);
    this.sessionsDoc.set(this.sessionsDoc.get().map((s) => (s.id === id ? { ...s, name } : s)));
    this.changed('sessions');
  }

  deleteSession(id: string): void {
    assertId(id);
    rmSync(join(this.paths.sessions, `${id}.json`), { force: true });
    this.sessionsDoc.set(this.sessionsDoc.get().filter((s) => s.id !== id));
    this.changed('sessions');
  }

  readSession(id: string): unknown {
    const f = this.sessionFile(id);
    return f ? JSON.parse(readFileSync(f, 'utf8')) : undefined;
  }
}
