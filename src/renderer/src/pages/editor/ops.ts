import { newStep, uid } from '@shared/defaults';
import type { Flow, Step, StepType } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { toast } from '@/store/toasts';

let clipboard: Step[] = [];

export function addStep(type: StepType, patch: Partial<Step> = {}) {
  const { flow, focusId, update, select } = useEditor.getState();
  if (!flow) return;
  const step = newStep(type, patch);
  update((f) => {
    const i = focusId ? f.steps.findIndex((s) => s.id === focusId) : -1;
    f.steps.splice(i >= 0 ? i + 1 : f.steps.length, 0, step);
  });
  select(step.id);
  return step;
}

export function deleteSteps(ids: string[]) {
  const { flow, update } = useEditor.getState();
  if (!flow || !ids.length) return;
  const idx = flow.steps.findIndex((s) => ids.includes(s.id));
  update((f) => {
    f.steps = f.steps.filter((s) => !ids.includes(s.id));
  });
  for (const id of ids) void api.live.forget(id);
  const after = useEditor.getState().flow!.steps;
  const next = after[Math.min(idx, after.length - 1)];
  useEditor.setState({ selected: next ? [next.id] : [], focusId: next?.id });
}

export function duplicateSteps(ids: string[]) {
  const { flow, update } = useEditor.getState();
  if (!flow || !ids.length) return;
  const copies: Step[] = [];
  update((f) => {
    const lastIdx = Math.max(...ids.map((id) => f.steps.findIndex((s) => s.id === id)));
    const chosen = f.steps.filter((s) => ids.includes(s.id));
    for (const s of chosen) copies.push({ ...structuredClone(s), id: uid('s') });
    f.steps.splice(lastIdx + 1, 0, ...copies);
  });
  useEditor.setState({ selected: copies.map((c) => c.id), focusId: copies[0]?.id });
}

export function toggleEnabled(ids: string[]) {
  const { flow, update } = useEditor.getState();
  if (!flow) return;
  const enable = flow.steps.filter((s) => ids.includes(s.id)).some((s) => !s.enabled);
  update((f) => {
    for (const s of f.steps) if (ids.includes(s.id)) s.enabled = enable;
  });
}

export function patchStep(id: string, patch: Partial<Step>, key?: string) {
  useEditor.getState().update(
    (f) => {
      const s = f.steps.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    },
    { key: key ? `${id}:${key}` : undefined },
  );
}

export function moveStep(activeId: string, overId: string) {
  useEditor.getState().update((f) => {
    const from = f.steps.findIndex((s) => s.id === activeId);
    const to = f.steps.findIndex((s) => s.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const [s] = f.steps.splice(from, 1);
    f.steps.splice(to, 0, s);
  });
}

export function moveSelection(dir: -1 | 1) {
  const { selected, update } = useEditor.getState();
  update((f) => {
    const idxs = f.steps.map((s, i) => (selected.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return;
    if (dir < 0 && idxs[0] === 0) return;
    if (dir > 0 && idxs[idxs.length - 1] === f.steps.length - 1) return;
    const order = dir < 0 ? idxs : idxs.slice().reverse();
    for (const i of order) {
      const j = i + dir;
      [f.steps[i], f.steps[j]] = [f.steps[j], f.steps[i]];
    }
  });
}

export function copySteps(ids: string[]) {
  const flow = useEditor.getState().flow;
  if (!flow) return;
  clipboard = flow.steps.filter((s) => ids.includes(s.id)).map((s) => structuredClone(s));
  void navigator.clipboard?.writeText(JSON.stringify({ format: 'xero-steps', steps: clipboard })).catch(() => undefined);
  toast.info(`Copied ${clipboard.length} step${clipboard.length === 1 ? '' : 's'}`);
}

export async function pasteSteps() {
  let steps = clipboard;
  try {
    const text = await navigator.clipboard?.readText();
    const parsed = text ? JSON.parse(text) : null;
    if (parsed?.format === 'xero-steps' && Array.isArray(parsed.steps)) steps = parsed.steps;
  } catch {
    /* use the in-app clipboard */
  }
  if (!steps.length) return;
  const { focusId, update } = useEditor.getState();
  const fresh = steps.map((s) => ({ ...structuredClone(s), id: uid('s') }));
  update((f) => {
    const i = focusId ? f.steps.findIndex((s) => s.id === focusId) : f.steps.length - 1;
    f.steps.splice(i + 1, 0, ...fresh);
  });
  useEditor.setState({ selected: fresh.map((s) => s.id), focusId: fresh[0].id });
}

export function knownVariables(flow: Flow, uptoIndex = Infinity): string[] {
  const out = new Set(flow.variables.map((v) => v.name).filter(Boolean));
  flow.steps.forEach((s, i) => {
    if (i >= uptoIndex) return;
    if (s.extract?.variable) out.add(s.extract.variable);
    if (s.type === 'setVariable' && s.variable) out.add(s.variable);
    if (s.value?.saveAs) out.add(s.value.saveAs);
    if (s.resultVariable) out.add(s.resultVariable);
  });
  return [...out];
}

export function flowVars(flow: Flow): Record<string, string> {
  return Object.fromEntries(flow.variables.map((v) => [v.name, v.value]));
}

/** Plays steps in the live browser, opening it (and fast-forwarding) when needed. */
export async function playInBrowser(from: number, to?: number) {
  const { flow, clearStatuses } = useEditor.getState();
  if (!flow || !flow.steps.length) return;
  const end = to ?? flow.steps.length - 1;
  const live = useApp.getState().live;
  const settings = useApp.getState().settings;
  const speed = flow.runDefaults?.speed ?? settings.runDefaults.speed;
  clearStatuses();
  try {
    let start = from;
    if (live.mode === 'closed' || live.flowId !== flow.id) {
      await api.live.start({ flowId: flow.id, record: false });
      if (from > 0) {
        toast.info(`Fast-forwarding through steps 1–${from} first`);
        const pre = await api.live.play({ steps: flow.steps, from: 0, to: from - 1, variables: flowVars(flow), speed: 0, pauseOnBreakpoints: false, dataLocale: flow.runDefaults?.dataLocale });
        if (pre.status !== 'passed') return;
      }
      start = from;
    }
    const res = await api.live.play({ steps: flow.steps, from: start, to: end, variables: { ...useEditor.getState().lastVars, ...flowVars(flow) }, speed, pauseOnBreakpoints: true, dataLocale: flow.runDefaults?.dataLocale });
    if (res.status === 'passed') toast.success('Playback finished', `${end - start + 1} step${end - start === 0 ? '' : 's'} ran without errors.`);
  } catch (e) {
    toast.error('Playback stopped', errorMessage(e));
  }
}
