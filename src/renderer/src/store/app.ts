import { create } from 'zustand';
import type { LiveEvent, LiveState, RunEvent } from '@shared/api';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { AppInfo, BrowserInfo, DatasetSummary, FlowSummary, Run, RunSummary, SavedSession, Schedule, Settings } from '@shared/types';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';

interface AppState {
  ready: boolean;
  settings: Settings;
  flows: FlowSummary[];
  runs: RunSummary[];
  datasets: DatasetSummary[];
  schedules: Schedule[];
  sessions: SavedSession[];
  browsers: BrowserInfo[];
  info?: AppInfo;
  live: LiveState;
  paletteOpen: boolean;
  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshBrowsers(): Promise<void>;
  setPalette(open: boolean): void;
}

type LiveListener = (e: LiveEvent) => void;
const liveListeners = new Set<LiveListener>();
export function onLive(fn: LiveListener) {
  liveListeners.add(fn);
  return () => liveListeners.delete(fn);
}

type RunListener = (e: RunEvent) => void;
const runListeners = new Set<RunListener>();
export function onRunEvent(fn: RunListener) {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
}

export function resolvedTheme(s: Settings): 'dark' | 'light' {
  if (s.theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return s.theme;
}

function applyTheme(s: Settings) {
  const t = resolvedTheme(s);
  document.documentElement.dataset.theme = t;
  void api.app.setTitleBarTheme(t);
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  flows: [],
  runs: [],
  datasets: [],
  schedules: [],
  sessions: [],
  browsers: [],
  live: { mode: 'closed', recordedCount: 0, tabs: 0 },
  paletteOpen: false,

  async init() {
    const [settings, flows, runs, datasets, schedules, sessions, browsers, info, live] = await Promise.all([
      api.settings.get(),
      api.flows.list(),
      api.runs.list(),
      api.datasets.list(),
      api.schedules.list(),
      api.sessions.list(),
      api.app.detectBrowsers(),
      api.app.info(),
      api.live.getState(),
    ]);
    applyTheme(settings);
    set({ ready: true, settings, flows, runs, datasets, schedules, sessions, browsers, info, live });

    api.settings.onChange((s) => {
      applyTheme(s);
      set({ settings: s });
    });
    api.flows.onChange((flows) => set({ flows }));
    api.datasets.onChange((datasets) => set({ datasets }));
    api.schedules.onChange((schedules) => set({ schedules }));
    api.sessions.onChange((sessions) => set({ sessions }));
    api.app.onNavigate((route) => navigate(route));
    api.live.onEvent((e) => {
      if (e.type === 'state') set({ live: e.state });
      for (const l of liveListeners) l(e);
    });
    api.runs.onEvent((e) => {
      if (e.type === 'run') {
        const list = get().runs.filter((r) => r.id !== e.run.id);
        list.unshift(e.run);
        list.sort((a, b) => b.startedAt - a.startedAt);
        set({ runs: list });
      } else if (e.type === 'removed') set({ runs: get().runs.filter((r) => r.id !== e.runId) });
      for (const l of runListeners) l(e);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().settings.theme === 'system') applyTheme(get().settings);
    });
  },

  async updateSettings(patch) {
    const next = await api.settings.update(patch);
    applyTheme(next);
    set({ settings: next });
  },

  async refreshBrowsers() {
    set({ browsers: await api.app.detectBrowsers() });
  },

  setPalette(open) {
    set({ paletteOpen: open });
  },
}));

export function isActiveRun(r: Pick<RunSummary, 'status'>): boolean {
  return r.status === 'running' || r.status === 'paused' || r.status === 'queued';
}

/** Applies streamed events to a full run object (used by the run detail page). */
export function applyRunEvent(run: Run, e: RunEvent): Run {
  if (e.type === 'run' && e.run.id === run.id) {
    const { stepCount: _s, avgDuration: _a, ...rest } = e.run;
    return { ...run, ...rest };
  }
  if (e.type === 'iteration' && e.runId === run.id) {
    const iterations = run.iterations.slice();
    const prev = iterations[e.iteration.index];
    const restarted = !prev || prev.startedAt !== e.iteration.startedAt;
    iterations[e.iteration.index] = { ...e.iteration, steps: restarted ? [] : prev.steps };
    if (e.iteration.status !== 'running' && prev && !restarted) iterations[e.iteration.index].steps = prev.steps;
    return { ...run, iterations };
  }
  if (e.type === 'steps' && e.runId === run.id) {
    const iterations = run.iterations.slice();
    for (const { iteration, result } of e.items) {
      const it = iterations[iteration];
      if (!it) continue;
      const steps = it.steps.filter((s) => s.index !== result.index);
      steps.push(result);
      steps.sort((a, b) => a.index - b.index);
      iterations[iteration] = { ...it, steps };
    }
    return { ...run, iterations };
  }
  if (e.type === 'log' && e.runId === run.id) {
    const logs = run.logs.concat(e.entries);
    return { ...run, logs: logs.length > 5000 ? logs.slice(-5000) : logs };
  }
  return run;
}
