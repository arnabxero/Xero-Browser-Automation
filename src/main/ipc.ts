import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import Papa from 'papaparse';
import { EVENTS, type ExportResult, type LivePlayOptions, type LiveStartOptions } from '../shared/api';
import { slugify } from '../shared/data/format';
import { uid } from '../shared/defaults';
import type { Dataset, Flow, RunOptions, RunTrigger, Schedule, Settings, Target } from '../shared/types';
import { detectBrowsers } from './browsers';
import { runDataCsv, runReportHtml, toCsv } from './export/report';
import { toPlaywright } from './export/playwright';
import type { LiveSession } from './live';
import type { Repo } from './repo';
import type { RunManager } from './runner';
import { computeNextRun, validateCron, type Scheduler } from './scheduler';

const require = createRequire(__filename);

export interface IpcContext {
  repo: Repo;
  live: LiveSession;
  runner: RunManager;
  scheduler: Scheduler;
  window: () => BrowserWindow | null;
  send: (channel: string, payload: unknown) => void;
  resourcesDir: string;
  applyTitleBar: (theme: 'dark' | 'light') => void;
  applyLoginItem: (s: Settings) => void;
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  });
}

/** Files this app wrote through a save dialog; only these (and the data folder) may be opened. */
const exported = new Set<string>();

function mayOpen(ctx: IpcContext, p: string): boolean {
  if (typeof p !== 'string' || !p) return false;
  const full = resolve(p);
  const root = resolve(ctx.repo.paths.root);
  return exported.has(full) || full === root || full.startsWith(root + sep);
}

async function saveAs(ctx: IpcContext, defaultName: string, filters: Electron.FileFilter[], content: string | Buffer): Promise<ExportResult> {
  const win = ctx.window();
  const opts = { defaultPath: join(app.getPath('documents'), defaultName), filters };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return { canceled: true };
  writeFileSync(res.filePath, content);
  exported.add(resolve(res.filePath));
  return { path: res.filePath };
}

export function registerIpc(ctx: IpcContext) {
  const { repo, live, runner, scheduler } = ctx;

  // ── App ─────────────────────────────────────────────────────────────────
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    playwright: (require('playwright-core/package.json') as { version: string }).version,
    dataDir: repo.paths.root,
    platform: `${process.platform} ${process.arch}`,
    playgroundUrl: pathToFileURL(join(ctx.resourcesDir, 'playground', 'index.html')).toString(),
  }));
  handle('app:openExternal', (url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  });
  handle('app:openPath', (p: string) => {
    if (!mayOpen(ctx, p)) throw new Error('That file can’t be opened from here.');
    return shell.openPath(p);
  });
  handle('app:showInFolder', (p: string) => {
    if (!mayOpen(ctx, p)) throw new Error('That file can’t be shown from here.');
    shell.showItemInFolder(p);
  });
  handle('app:revealDataFolder', () => shell.openPath(repo.paths.root));
  handle('app:detectBrowsers', () => detectBrowsers(repo.settings().customBrowserPath));
  handle('app:setTitleBarTheme', (theme: 'dark' | 'light') => ctx.applyTitleBar(theme));
  handle('app:chooseFiles', async (opts?: { multiple?: boolean; title?: string; filters?: Electron.FileFilter[] }) => {
    const win = ctx.window();
    const o: Electron.OpenDialogOptions = { title: opts?.title ?? 'Choose files', properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: opts?.filters };
    const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
    return res.canceled ? [] : res.filePaths;
  });
  handle('app:chooseExecutable', async () => {
    const win = ctx.window();
    const o: Electron.OpenDialogOptions = { title: 'Choose a Chromium-based browser', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] };
    const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
  handle('app:installChromium', () =>
    new Promise<{ ok: boolean; message: string }>((resolve) => {
      let cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
      cli = cli.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
      const pipe = (buf: Buffer) => {
        for (const line of buf.toString().split(/\r?\n|\r/)) if (line.trim()) ctx.send(EVENTS.install, line.trim());
      };
      child.stdout.on('data', pipe);
      child.stderr.on('data', pipe);
      child.on('error', (e) => resolve({ ok: false, message: e.message }));
      child.on('close', (code) => resolve(code === 0 ? { ok: true, message: 'Chromium is ready to use.' } : { ok: false, message: `The download failed (exit code ${code}).` }));
    }),
  );

  // ── Settings ────────────────────────────────────────────────────────────
  handle('settings:get', () => repo.settings());
  handle('settings:update', (patch: Partial<Settings>) => {
    const before = repo.settings();
    const next = repo.updateSettings(patch);
    if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== before.launchAtLogin) ctx.applyLoginItem(next);
    return next;
  });

  // ── Flows ───────────────────────────────────────────────────────────────
  handle('flows:list', () => repo.listFlows());
  handle('flows:get', (id: string) => repo.getFlow(id));
  handle('flows:save', (flow: Flow) => {
    // Run results are written by the runner; never let an open editor overwrite them.
    const cur = repo.getFlow(flow.id);
    return repo.saveFlow({ ...flow, lastRun: cur?.lastRun ?? flow.lastRun, runCount: cur?.runCount ?? flow.runCount });
  });
  handle('flows:create', (patch?: Partial<Flow>) => repo.createFlow(patch));
  handle('flows:delete', (id: string) => repo.deleteFlow(id));
  handle('flows:duplicate', (id: string) => repo.duplicateFlow(id));
  handle('flows:importFiles', async () => {
    const win = ctx.window();
    const o: Electron.OpenDialogOptions = { title: 'Import flows', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Xero flows', extensions: ['json'] }] };
    const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
    if (res.canceled) return [];
    const out: Flow[] = [];
    for (const file of res.filePaths) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw?.flows && Array.isArray(raw.flows) ? raw.flows : [raw];
      for (const item of list) {
        const f = repo.importFlow(item);
        if (f) out.push(f);
      }
    }
    if (!out.length) throw new Error('No flows were found in the selected files.');
    return out;
  });
  handle('flows:exportFile', (id: string, format: 'json' | 'playwright') => {
    const flow = repo.getFlow(id);
    if (!flow) throw new Error('Flow not found');
    const base = slugify(flow.name) || 'flow';
    if (format === 'playwright') return saveAs(ctx, `${base}.spec.ts`, [{ name: 'TypeScript', extensions: ['ts'] }], toPlaywright(flow));
    const { lastRun: _l, runCount: _r, ...portable } = flow;
    return saveAs(ctx, `${base}.xero.json`, [{ name: 'Xero flow', extensions: ['json'] }], JSON.stringify({ format: 'xero-flow', version: 1, ...portable }, null, 2));
  });

  // ── Live browser ────────────────────────────────────────────────────────
  handle('live:start', (opts: LiveStartOptions) => live.start(opts));
  handle('live:record', () => live.record());
  handle('live:pause', () => live.pause());
  handle('live:resume', () => live.resume());
  handle('live:stopRecording', () => live.stopRecording());
  handle('live:close', () => live.close());
  handle('live:getState', () => live.state());
  handle('live:play', (opts: LivePlayOptions) => live.play(opts));
  handle('live:playControl', (cmd: 'pause' | 'resume' | 'step' | 'stop') => live.playControl(cmd));
  handle('live:pick', () => live.pick());
  handle('live:cancelPick', () => live.cancelPick());
  handle('live:highlight', (t: Target, tab?: number) => live.highlight(t, tab));
  handle('live:testTarget', (t: Target, tab?: number) => live.testTarget(t, tab));
  handle('live:saveSession', (name: string) => live.saveSession(name));
  handle('live:forget', (id: string) => live.forget(id));
  handle('live:addAssertion', (kind: 'url' | 'title') => live.addAssertion(kind));

  // ── Runs ────────────────────────────────────────────────────────────────
  handle('runs:start', (flowId: string, options: Partial<RunOptions>, trigger?: RunTrigger) => runner.start(flowId, options ?? {}, trigger ?? 'manual'));
  handle('runs:stop', (id: string) => runner.stop(id));
  handle('runs:pause', (id: string) => runner.pause(id));
  handle('runs:resume', (id: string) => runner.resume(id));
  handle('runs:list', () => repo.runs.list());
  handle('runs:get', (id: string) => runner.getLive(id) ?? repo.runs.get(id));
  handle('runs:delete', (id: string) => {
    if (runner.isActive(id)) throw new Error('Stop the run before deleting it.');
    repo.runs.delete(id);
    ctx.send(EVENTS.runs, { type: 'removed', runId: id });
  });
  handle('runs:clear', () => {
    for (const r of repo.runs.list()) {
      if (runner.isActive(r.id)) continue;
      repo.runs.delete(r.id);
      ctx.send(EVENTS.runs, { type: 'removed', runId: r.id });
    }
  });
  handle('runs:peek', (id: string, iteration?: number) => runner.peek(id, iteration));
  handle('runs:exportReport', (id: string, format: 'html' | 'json' | 'csv') => {
    const run = runner.getLive(id) ?? repo.runs.get(id);
    if (!run) throw new Error('Run not found');
    const base = `${slugify(run.flowName) || 'run'}-${new Date(run.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    if (format === 'html') return saveAs(ctx, `${base}.html`, [{ name: 'HTML report', extensions: ['html'] }], runReportHtml(run, repo.runs.artifactsDir(id)));
    if (format === 'csv') return saveAs(ctx, `${base}-data.csv`, [{ name: 'CSV', extensions: ['csv'] }], `﻿${runDataCsv(run)}`);
    return saveAs(ctx, `${base}.json`, [{ name: 'JSON', extensions: ['json'] }], JSON.stringify(run, null, 2));
  });

  // ── Datasets ────────────────────────────────────────────────────────────
  handle('datasets:list', () => repo.listDatasets());
  handle('datasets:get', (id: string) => repo.getDataset(id));
  handle('datasets:save', (ds: Dataset) => repo.saveDataset(ds));
  handle('datasets:delete', (id: string) => repo.deleteDataset(id));
  handle('datasets:importFile', async () => {
    const win = ctx.window();
    const o: Electron.OpenDialogOptions = { title: 'Import data', properties: ['openFile'], filters: [{ name: 'CSV or JSON', extensions: ['csv', 'tsv', 'txt', 'json'] }] };
    const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
    let rows: Record<string, string>[] = [];
    let columns: string[] = [];
    if (/\.json$/i.test(file)) {
      const raw = JSON.parse(text);
      const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
      const colSet = new Set<string>();
      rows = arr
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            colSet.add(k);
            out[k] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          }
          return out;
        });
      columns = [...colSet];
    } else {
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
      columns = (parsed.meta.fields ?? []).filter(Boolean);
      rows = parsed.data.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ''])));
    }
    if (!columns.length) throw new Error('No columns were found. The first row of a CSV file must contain column names.');
    const name = file.split(/[\\/]/).pop()!.replace(/\.(csv|tsv|txt|json)$/i, '');
    const now = Date.now();
    return repo.saveDataset({ id: uid('d'), name, columns, rows, createdAt: now, updatedAt: now, source: file });
  });
  handle('datasets:exportCsv', (id: string) => {
    const ds = repo.getDataset(id);
    if (!ds) throw new Error('Dataset not found');
    return saveAs(ctx, `${slugify(ds.name) || 'dataset'}.csv`, [{ name: 'CSV', extensions: ['csv'] }], `﻿${toCsv(ds.columns, ds.rows)}`);
  });
  handle('datasets:exportRows', (name: string, columns: string[], rows: Record<string, string>[]) =>
    saveAs(ctx, `${slugify(name) || 'data'}.csv`, [{ name: 'CSV', extensions: ['csv'] }], `﻿${toCsv(columns, rows)}`),
  );

  // ── Schedules ───────────────────────────────────────────────────────────
  handle('schedules:list', () => repo.listSchedules());
  handle('schedules:save', (s: Schedule) => {
    if (s.kind === 'cron') {
      const err = validateCron(s.cron ?? '');
      if (err) throw new Error(`The cron expression is not valid: ${err}`);
    }
    const next: Schedule = { ...s, nextRunAt: computeNextRun(s) };
    return repo.saveSchedule(next);
  });
  handle('schedules:delete', (id: string) => repo.deleteSchedule(id));
  handle('schedules:runNow', (id: string) => {
    const s = repo.listSchedules().find((x) => x.id === id);
    if (!s) throw new Error('Schedule not found');
    return scheduler.runNow(s);
  });

  // ── Saved sessions ──────────────────────────────────────────────────────
  handle('sessions:list', () => repo.listSessions());
  handle('sessions:rename', (id: string, name: string) => repo.renameSession(id, name));
  handle('sessions:delete', (id: string) => repo.deleteSession(id));
}
