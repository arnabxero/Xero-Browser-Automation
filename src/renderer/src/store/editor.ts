import { create } from 'zustand';
import type { Flow, Step, StepResult, StepStatus, Target } from '@shared/types';
import { api, errorMessage } from '@/lib/api';

export interface StepRunState {
  status: StepStatus;
  error?: string;
  message?: string;
  duration?: number;
  value?: string;
  healed?: StepResult['healed'];
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

interface EditorState {
  flow: Flow | null;
  loadError?: string;
  selected: string[];
  focusId?: string;
  past: Flow[];
  future: Flow[];
  save: SaveState;
  statuses: Record<string, StepRunState>;
  /** Where recorded steps are inserted: after this step id, 'start', or 'end'. */
  insertAfter: string | 'start' | 'end';
  lastVars: Record<string, string>;
  load(id: string): Promise<void>;
  close(): void;
  update(mut: (f: Flow) => void, opts?: { history?: boolean; key?: string }): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;
  select(id: string, mode?: 'single' | 'toggle' | 'range'): void;
  selectAll(): void;
  clearSelection(): void;
  setInsertAfter(v: string | 'start' | 'end'): void;
  applyRecorded(op: { op: 'add'; step: Step } | { op: 'update'; step: Step } | { op: 'remove'; id: string }): void;
  setStatus(stepId: string, s: StepRunState): void;
  clearStatuses(): void;
  setTarget(stepId: string, target: Target, field?: 'target' | 'destination'): void;
  flushSave(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastKey: string | undefined;
let lastKeyAt = 0;

function scheduleSave() {
  clearTimeout(saveTimer);
  useEditor.setState({ save: 'pending' });
  saveTimer = setTimeout(() => void useEditor.getState().flushSave(), 550);
}

export const useEditor = create<EditorState>((set, get) => ({
  flow: null,
  selected: [],
  past: [],
  future: [],
  save: 'saved',
  statuses: {},
  insertAfter: 'end',
  lastVars: {},

  async load(id) {
    if (get().flow?.id === id) return;
    await get().flushSave();
    set({ flow: null, loadError: undefined, selected: [], focusId: undefined, past: [], future: [], statuses: {}, insertAfter: 'end', lastVars: {} });
    try {
      const flow = await api.flows.get(id);
      if (!flow) set({ loadError: 'This flow no longer exists.' });
      else set({ flow, focusId: flow.steps[0]?.id, selected: flow.steps[0] ? [flow.steps[0].id] : [] });
    } catch (e) {
      set({ loadError: errorMessage(e) });
    }
  },

  close() {
    void get().flushSave();
    set({ flow: null, selected: [], focusId: undefined, past: [], future: [], statuses: {} });
  },

  update(mut, opts = {}) {
    const cur = get().flow;
    if (!cur) return;
    const next = structuredClone(cur);
    mut(next);
    const now = Date.now();
    const coalesce = opts.key && opts.key === lastKey && now - lastKeyAt < 1200;
    lastKey = opts.key;
    lastKeyAt = now;
    const pushHistory = opts.history !== false && !coalesce;
    set((s) => ({
      flow: next,
      past: pushHistory ? [...s.past.slice(-99), cur] : s.past,
      future: pushHistory ? [] : s.future,
    }));
    scheduleSave();
  },

  checkpoint() {
    const cur = get().flow;
    if (!cur) return;
    lastKey = undefined;
    set((s) => ({ past: [...s.past.slice(-99), structuredClone(cur)], future: [] }));
  },

  undo() {
    const { past, flow } = get();
    if (!past.length || !flow) return;
    const prev = past[past.length - 1];
    lastKey = undefined;
    set((s) => ({ flow: prev, past: s.past.slice(0, -1), future: [flow, ...s.future].slice(0, 100) }));
    scheduleSave();
  },

  redo() {
    const { future, flow } = get();
    if (!future.length || !flow) return;
    const next = future[0];
    lastKey = undefined;
    set((s) => ({ flow: next, future: s.future.slice(1), past: [...s.past, flow] }));
    scheduleSave();
  },

  select(id, mode = 'single') {
    const { selected, flow, focusId } = get();
    if (!flow) return;
    if (mode === 'toggle') {
      const has = selected.includes(id);
      const next = has ? selected.filter((x) => x !== id) : [...selected, id];
      set({ selected: next, focusId: has ? next[next.length - 1] : id });
      return;
    }
    if (mode === 'range' && focusId) {
      const ids = flow.steps.map((s) => s.id);
      const a = ids.indexOf(focusId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        set({ selected: ids.slice(lo, hi + 1) });
        return;
      }
    }
    set({ selected: [id], focusId: id });
  },

  selectAll() {
    const f = get().flow;
    if (f) set({ selected: f.steps.map((s) => s.id) });
  },

  clearSelection() {
    set({ selected: [] });
  },

  setInsertAfter(v) {
    set({ insertAfter: v });
  },

  applyRecorded(op) {
    const cur = get().flow;
    if (!cur) return;
    const steps = cur.steps.slice();
    let insertAfter = get().insertAfter;
    if (op.op === 'add') {
      let at = steps.length;
      if (insertAfter === 'start') at = 0;
      else if (insertAfter !== 'end') {
        const i = steps.findIndex((s) => s.id === insertAfter);
        at = i >= 0 ? i + 1 : steps.length;
      }
      steps.splice(at, 0, op.step);
      if (insertAfter !== 'end') insertAfter = op.step.id;
      const startUrl = cur.startUrl ?? (op.step.type === 'navigate' ? op.step.url : undefined);
      set({ flow: { ...cur, steps, startUrl }, insertAfter, focusId: op.step.id, selected: [op.step.id] });
    } else if (op.op === 'update') {
      const i = steps.findIndex((s) => s.id === op.step.id);
      if (i < 0) return;
      steps[i] = op.step;
      set({ flow: { ...cur, steps } });
    } else {
      const i = steps.findIndex((s) => s.id === op.id);
      if (i < 0) return;
      steps.splice(i, 1);
      if (insertAfter === op.id) insertAfter = i > 0 ? steps[i - 1].id : 'start';
      set({ flow: { ...cur, steps }, insertAfter, selected: get().selected.filter((x) => x !== op.id) });
    }
    scheduleSave();
  },

  setStatus(stepId, s) {
    set((st) => ({ statuses: { ...st.statuses, [stepId]: s } }));
  },

  clearStatuses() {
    set({ statuses: {} });
  },

  setTarget(stepId, target, field = 'target') {
    get().update((f) => {
      const s = f.steps.find((x) => x.id === stepId);
      if (s) s[field] = target;
    });
  },

  async flushSave() {
    clearTimeout(saveTimer);
    const flow = get().flow;
    if (!flow || get().save === 'saved') return;
    set({ save: 'saving' });
    try {
      await api.flows.save(flow);
      if (get().flow === flow) set({ save: 'saved' });
      else set({ save: 'pending' });
    } catch {
      set({ save: 'error' });
    }
  },
}));

window.addEventListener('beforeunload', () => {
  void useEditor.getState().flushSave();
});
