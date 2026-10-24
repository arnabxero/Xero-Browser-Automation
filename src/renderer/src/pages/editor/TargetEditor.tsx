import { ArrowDown, ArrowUp, Crosshair, Eye, FlaskConical, Frame, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TargetTestResult } from '@shared/api';
import type { SelectorCandidate, SelectorKind, Target } from '@shared/types';
import { Button, IconButton, Input, Select, Tooltip, cn } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { toast } from '@/store/toasts';

const KIND_LABEL: Record<SelectorKind, string> = {
  testid: 'Test id',
  id: 'Id',
  role: 'Role',
  label: 'Label',
  placeholder: 'Placeholder',
  text: 'Text',
  name: 'Name',
  alt: 'Alt text',
  title: 'Title',
  css: 'CSS',
  xpath: 'XPath',
};

function candidateText(c: SelectorCandidate) {
  if (c.kind === 'role') return `${c.value}${c.name ? ` “${c.name}”` : ''}`;
  if (c.kind === 'testid') return `${c.attr ?? 'data-testid'}=${c.value}`;
  return c.value;
}

export async function ensureLiveBrowser(flowId: string, startUrl?: string): Promise<boolean> {
  const live = useApp.getState().live;
  if (live.mode !== 'closed' && live.flowId === flowId) return true;
  try {
    await api.live.start({ flowId, url: startUrl, record: false });
    return true;
  } catch (e) {
    toast.error('The browser could not open', errorMessage(e));
    return false;
  }
}

export function TargetEditor({ target, onChange, stepTab, label = 'Element' }: { target?: Target; onChange: (t: Target) => void; stepTab?: number; label?: string }) {
  const flow = useEditor((s) => s.flow)!;
  const live = useApp((s) => s.live);
  const [test, setTest] = useState<TargetTestResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<SelectorKind>('css');
  const [newValue, setNewValue] = useState('');
  const liveOpen = live.mode !== 'closed' && live.flowId === flow.id;

  const pick = async () => {
    if (!(await ensureLiveBrowser(flow.id, flow.startUrl))) return;
    setPicking(true);
    try {
      const t = await api.live.pick();
      if (t) {
        onChange(t);
        setTest(null);
        toast.success('Element updated', t.description);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  const runTest = async (highlight: boolean) => {
    if (!target) return;
    if (!liveOpen) {
      toast.info('Open the live browser first', 'Play the flow up to this step so the page shows the element, then test again.');
      return;
    }
    try {
      const r = highlight ? await api.live.highlight(target, stepTab) : await api.live.testTarget(target, stepTab);
      setTest(r);
      if (!r.frameFound) toast.warn('The frame containing this element is not on the current page');
      else if (r.bestIndex < 0 && !r.candidates.some((c) => c.count > 0)) toast.warn('No selector matches on the current page', 'Play the flow up to this step, or pick the element again.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const update = (selectors: SelectorCandidate[]) => {
    if (!target) return;
    onChange({ ...target, selectors });
    setTest(null);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" icon={Eye} label="Highlight in the browser" onClick={() => void runTest(true)} disabled={!target} />
          <IconButton size="sm" icon={FlaskConical} label="Test every selector" onClick={() => void runTest(false)} disabled={!target} />
          <Button size="sm" variant={picking ? 'subtle' : 'secondary'} icon={Crosshair} onClick={() => (picking ? void api.live.cancelPick() : void pick())}>
            {picking ? 'Click it in the browser…' : target ? 'Pick again' : 'Pick element'}
          </Button>
        </div>
      </div>
      {target ? (
        <>
          <p className="selectable truncate rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[13px] text-ink" title={target.description}>
            {target.description}
          </p>
          {target.framePath?.length ? (
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Frame size={13} /> Inside frame <span className="font-mono">{target.framePath.map((f) => f.selector).join(' › ')}</span>
            </p>
          ) : null}
          <div className="overflow-hidden rounded-lg border border-line">
            {target.selectors.map((c, i) => {
              const r = test?.candidates.find((x) => x.index === i);
              return (
                <div key={`${c.kind}-${i}`} className={cn('group flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0', test?.bestIndex === i && 'bg-pass-soft')}>
                  <span className="w-[86px] shrink-0 truncate text-[11.5px] font-medium whitespace-nowrap text-ink-3">
                    {i + 1}. {KIND_LABEL[c.kind]}
                  </span>
                  <span className="selectable min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={candidateText(c)}>
                    {candidateText(c)}
                    {c.nth !== undefined && <span className="text-ink-3"> #{c.nth + 1}</span>}
                  </span>
                  {r && (
                    <span className={cn('tnum shrink-0 text-[11px] font-medium', r.count === 1 ? 'text-pass' : r.count === 0 ? 'text-fail' : 'text-warn')}>
                      {r.count === 1 ? 'Unique' : r.count === 0 ? 'No match' : `${r.count} matches`}
                    </span>
                  )}
                  <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                    <IconButton size="sm" icon={ArrowUp} label="Try earlier" disabled={i === 0} onClick={() => update(target.selectors.map((x, j) => (j === i - 1 ? c : j === i ? target.selectors[i - 1] : x)))} />
                    <IconButton size="sm" icon={ArrowDown} label="Try later" disabled={i === target.selectors.length - 1} onClick={() => update(target.selectors.map((x, j) => (j === i + 1 ? c : j === i ? target.selectors[i + 1] : x)))} />
                    <IconButton size="sm" icon={Trash2} label="Remove" tone="danger" disabled={target.selectors.length <= 1} onClick={() => update(target.selectors.filter((_, j) => j !== i))} />
                  </div>
                </div>
              );
            })}
          </div>
          {adding ? (
            <div className="flex items-center gap-2">
              <div className="w-[120px] shrink-0">
                <Select size="sm" value={newKind} onChange={setNewKind} options={(Object.keys(KIND_LABEL) as SelectorKind[]).filter((k) => k !== 'role').map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              </div>
              <Input inputSize="sm" mono autoFocus value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={newKind === 'xpath' ? '//button[1]' : newKind === 'css' ? '#submit' : 'value'} />
              <Button
                size="sm"
                variant="primary"
                disabled={!newValue.trim()}
                onClick={() => {
                  update([{ kind: newKind, value: newValue.trim(), score: 99, attr: newKind === 'testid' ? 'data-testid' : undefined }, ...target.selectors]);
                  setAdding(false);
                  setNewValue('');
                }}
              >
                Add
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button type="button" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-accent" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add your own selector
              </button>
              <Tooltip content="If every selector stops matching, Xero looks for the most similar element using its text, attributes and classes.">
                <span className="text-[11.5px] text-ink-3 underline decoration-dotted underline-offset-2">Similarity fallback on</span>
              </Tooltip>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3">No element yet. Use “Pick element” and click it in the browser.</p>
      )}
    </div>
  );
}
