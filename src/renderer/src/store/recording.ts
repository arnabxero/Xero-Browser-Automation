import { create } from 'zustand';
import type { LiveEvent } from '@shared/api';
import { domainOf, normalizeUrl } from '@shared/defaults';
import { shortUrl } from '@shared/steps';
import type { BrowserChoice, Flow, Step } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { onLive, useApp } from './app';
import { useEditor } from './editor';
import { toast } from './toasts';

interface RecordingUi {
  /** Set after a recording stops so the editor can offer generated data. */
  smartFillFor: string | null;
  setSmartFill(flowId: string | null): void;
}

export const useRecordingUi = create<RecordingUi>((set) => ({
  smartFillFor: null,
  setSmartFill: (flowId) => set({ smartFillFor: flowId }),
}));

let background: Promise<unknown> = Promise.resolve();

function applyToFlow(flow: Flow, e: Extract<LiveEvent, { type: 'recorded' }>): Flow {
  const steps: Step[] = flow.steps.slice();
  if (e.op === 'add') steps.push(e.step);
  else if (e.op === 'update') {
    const i = steps.findIndex((s) => s.id === e.step.id);
    if (i >= 0) steps[i] = e.step;
  } else {
    const i = steps.findIndex((s) => s.id === e.id);
    if (i >= 0) steps.splice(i, 1);
  }
  return { ...flow, steps };
}

let wired = false;
export function wireRecording() {
  if (wired) return;
  wired = true;
  onLive((e) => {
    const flowId = useApp.getState().live.flowId;
    const editor = useEditor.getState();
    const inEditor = !!flowId && editor.flow?.id === flowId;
    switch (e.type) {
      case 'recorded':
        if (inEditor) editor.applyRecorded(e);
        else if (flowId) {
          // The editor is closed: write recorded steps straight to the flow.
          background = background.then(async () => {
            const f = await api.flows.get(flowId);
            if (f) await api.flows.save(applyToFlow(f, e));
          });
        }
        break;
      case 'stepStatus':
        if (inEditor) editor.setStatus(e.stepId, { status: e.status, error: e.error, duration: e.duration, message: e.message, value: e.value, healed: e.healed });
        break;
      case 'healed':
        if (inEditor) {
          editor.setTarget(e.stepId, e.target);
          toast.info('Updated a selector', 'An element had changed on the page, so its step now points at the element that matched.');
        }
        break;
      case 'vars':
        if (inEditor) useEditor.setState({ lastVars: e.vars });
        break;
      case 'stopRequested':
        void stopRecording();
        break;
      case 'notice':
        if (e.level === 'error') toast.error(e.message);
        else if (e.level === 'warn') toast.warn(e.message);
        else if (e.level === 'success') toast.success(e.message);
        else toast.info(e.message);
        break;
      case 'state':
        if (e.state.mode === 'closed' && e.state.error) toast.error('The browser could not open', e.state.error);
        break;
    }
  });
}

export async function startNewRecording(opts: { url: string; name?: string; browser?: BrowserChoice; sessionId?: string }) {
  const url = normalizeUrl(opts.url);
  if (!url) throw new Error('Enter a website address to record');
  let host = domainOf(url) ?? 'page';
  if (host === 'Local file') {
    const s = shortUrl(url).replace(/^the /, '');
    host = s.charAt(0).toUpperCase() + s.slice(1);
  }
  const when = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const flow = await api.flows.create({ name: opts.name?.trim() || `${host} — ${when}`, startUrl: url });
  navigate(`/flows/${flow.id}`);
  await waitForEditor(flow.id);
  useEditor.getState().setInsertAfter('end');
  useEditor.getState().checkpoint();
  try {
    await api.live.start({ flowId: flow.id, url, record: true, addNavigateStep: true, browser: opts.browser, sessionId: opts.sessionId });
  } catch (e) {
    toast.error('Recording could not start', errorMessage(e));
  }
  return flow.id;
}

/** Record into an existing flow. With `replayUntil`, replays steps up to that index first. */
export async function recordInto(flow: Flow, opts: { insertAfter: string | 'start' | 'end'; replayUntil?: number; browser?: BrowserChoice; sessionId?: string }) {
  const editor = useEditor.getState();
  editor.setInsertAfter(opts.insertAfter);
  editor.checkpoint();
  const live = useApp.getState().live;
  const replay = opts.replayUntil !== undefined ? flow.steps.slice(0, opts.replayUntil + 1).filter((s) => s.enabled) : undefined;
  const sameFlowOpen = live.mode !== 'closed' && live.flowId === flow.id;
  try {
    if (sameFlowOpen && !replay) await api.live.record();
    else {
      const url = !replay?.length ? (flow.startUrl ?? flow.steps.find((s) => s.type === 'navigate')?.url) : undefined;
      await api.live.start({
        flowId: flow.id,
        url,
        record: true,
        addNavigateStep: !!url && flow.steps.length === 0,
        replay,
        variables: Object.fromEntries(flow.variables.map((v) => [v.name, v.value])),
        browser: opts.browser,
        sessionId: opts.sessionId,
      });
    }
  } catch (e) {
    toast.error('Recording could not start', errorMessage(e));
  }
}

export async function stopRecording() {
  const live = useApp.getState().live;
  try {
    await api.live.stopRecording();
  } catch (e) {
    toast.error(errorMessage(e));
  }
  await background;
  const flowId = live.flowId;
  if (!flowId) return;
  const editor = useEditor.getState();
  await editor.flushSave();
  if (editor.flow?.id !== flowId) navigate(`/flows/${flowId}`);
  await waitForEditor(flowId);
  const f = useEditor.getState().flow;
  const candidates = f?.steps.filter((s) => s.type === 'fill' && s.value?.mode === 'static' && (s.suggestions?.[0]?.confidence ?? 0) >= 0.5) ?? [];
  if (candidates.length && !useApp.getState().settings.recorder.autoRandomize) useRecordingUi.getState().setSmartFill(flowId);
  else toast.success('Recording saved', `${f?.steps.length ?? 0} steps in “${f?.name ?? 'flow'}”.`);
}

function waitForEditor(flowId: string, timeout = 4000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (useEditor.getState().flow?.id === flowId || Date.now() - start > timeout) resolve();
      else setTimeout(tick, 40);
    };
    tick();
  });
}
