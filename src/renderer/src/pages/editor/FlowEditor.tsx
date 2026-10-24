import { ArrowLeft, Check, CircleAlert, CircleDot, Copy, Download, Ellipsis, FileCode, History, LoaderCircle, Play, Redo2, Sparkles, StepForward, Tag, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDuration, relativeTime } from '@shared/data/format';
import { mergeRunOptions } from '@shared/defaults';
import type { ValueSource } from '@shared/types';
import { IterationStrip } from '@/components/charts';
import { RunOptionsForm } from '@/components/RunOptions';
import { SmartFillDialog, smartFillCandidates } from '@/components/SmartFill';
import { Button, EmptyState, IconButton, Input, Menu, MenuItem, MenuSeparator, Popover, Spinner, Tabs, Tooltip, cn } from '@/components/ui';
import { RunStatusBadge } from '@/components/visuals';
import { useHotkeys } from '@/lib/hotkeys';
import { api } from '@/lib/api';
import { back, navigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { recordInto, useRecordingUi } from '@/store/recording';
import { toast } from '@/store/toasts';
import { useUi } from '@/store/ui';
import { deleteFlow, exportFlow } from '../Flows';
import { Inspector } from './Inspector';
import { LiveBar } from './LiveBar';
import { copySteps, deleteSteps, duplicateSteps, moveSelection, pasteSteps, playInBrowser } from './ops';
import { StepTrack } from './StepTrack';
import { VariablesTab } from './VariablesTab';

type Tab = 'steps' | 'variables' | 'settings' | 'runs';

function SaveIndicator() {
  const save = useEditor((s) => s.save);
  if (save === 'saving' || save === 'pending')
    return (
      <span className="flex items-center gap-1 text-[12px] text-ink-3">
        <LoaderCircle size={12} className="spin" /> Saving
      </span>
    );
  if (save === 'error')
    return (
      <span className="flex items-center gap-1 text-[12px] text-fail">
        <CircleAlert size={12} /> Not saved
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[12px] text-ink-3">
      <Check size={12} /> Saved
    </span>
  );
}

function TagEditor() {
  const flow = useEditor((s) => s.flow)!;
  const update = useEditor((s) => s.update);
  const all = useApp((s) => s.flows);
  const [draft, setDraft] = useState('');
  const known = [...new Set(all.flatMap((f) => f.tags))].filter((t) => !flow.tags.includes(t));
  const add = (t: string) => {
    const v = t.trim();
    if (v && !flow.tags.includes(v)) update((f) => void f.tags.push(v));
    setDraft('');
  };
  return (
    <Popover
      align="start"
      className="w-[280px] p-3"
      trigger={
        <button type="button" className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-ink-3 hover:bg-raised hover:text-ink">
          <Tag size={12} />
          {flow.tags.length ? flow.tags.join(', ') : 'Add tags'}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {flow.tags.map((t) => (
            <button key={t} type="button" onClick={() => update((f) => void (f.tags = f.tags.filter((x) => x !== t)))} className="rounded-md bg-accent-soft px-1.5 text-[12px] text-accent hover:line-through">
              {t}
            </button>
          ))}
        </div>
        <Input inputSize="sm" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(draft)} placeholder="Type a tag and press Enter" />
        {known.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {known.slice(0, 12).map((t) => (
              <button key={t} type="button" onClick={() => add(t)} className="rounded-md border border-line px-1.5 text-[12px] text-ink-2 hover:text-ink">
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}

function RunsTab() {
  const flow = useEditor((s) => s.flow)!;
  const runs = useApp((s) => s.runs).filter((r) => r.flowId === flow.id);
  if (!runs.length)
    return (
      <EmptyState icon={History} title="No runs yet">
        Runs of this flow and their reports appear here.
      </EmptyState>
    );
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        {runs.map((r) => (
          <button key={r.id} type="button" onClick={() => navigate(`/runs/${r.id}`)} className="grid w-full grid-cols-[150px_minmax(0,1fr)_120px_100px_110px] items-center gap-4 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-raised/50">
            <span className="text-[12.5px] text-ink-2">{relativeTime(r.startedAt)}</span>
            <IterationStrip iterations={Array.from({ length: Math.min(r.totals.total, 80) }, (_, i) => ({ index: i, status: i < r.totals.passed ? 'passed' : i < r.totals.passed + r.totals.failed ? 'failed' : i < r.totals.passed + r.totals.failed + r.totals.stopped ? 'stopped' : 'pending' }))} />
            <span className="tnum text-[12.5px] text-ink-2">
              {r.totals.passed} / {r.totals.total} passed
            </span>
            <span className="tnum text-[12.5px] text-ink-3">{formatDuration(r.duration)}</span>
            <RunStatusBadge status={r.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsTab() {
  const flow = useEditor((s) => s.flow)!;
  const update = useEditor((s) => s.update);
  const defaults = useApp((s) => s.settings.runDefaults);
  const value = mergeRunOptions(defaults, flow.runDefaults);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 py-6">
        <p className="mb-5 text-[13px] text-ink-2">These settings are used whenever this flow runs, including from schedules. You can still change them for a single run.</p>
        <div className="rounded-xl border border-line bg-panel p-6">
          <RunOptionsForm value={value} onChange={(p) => update((f) => void (f.runDefaults = { ...(f.runDefaults ?? {}), ...p }), { key: 'runDefaults' })} />
        </div>
        <div className="mt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Description</span>
            <textarea
              className="min-h-[80px] w-full rounded-lg border border-line bg-sunken px-2.5 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
              value={flow.description ?? ''}
              onChange={(e) => update((f) => void (f.description = e.target.value || undefined), { key: 'desc' })}
              placeholder="What this flow does and when to use it"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export function FlowEditor({ id }: { id: string }) {
  const flow = useEditor((s) => s.flow);
  const loadError = useEditor((s) => s.loadError);
  const load = useEditor((s) => s.load);
  const update = useEditor((s) => s.update);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const focusId = useEditor((s) => s.focusId);
  const live = useApp((s) => s.live);
  const openRun = useUi((s) => s.openRunDialog);
  const smartFillFor = useRecordingUi((s) => s.smartFillFor);
  const setSmartFillFor = useRecordingUi((s) => s.setSmartFill);
  const [tab, setTab] = useState<Tab>('steps');
  const [smartOpen, setSmartOpen] = useState(false);

  useEffect(() => {
    void load(id);
    return () => {
      void useEditor.getState().flushSave();
    };
  }, [id, load]);

  useEffect(() => {
    if (smartFillFor && flow?.id === smartFillFor) {
      setSmartFillFor(null);
      setTab('steps');
      setSmartOpen(true);
    }
  }, [smartFillFor, flow?.id, setSmartFillFor]);

  const thisLive = !!flow && live.flowId === flow.id && live.mode !== 'closed';
  const recording = thisLive && (live.mode === 'recording' || live.mode === 'paused');
  const playing = thisLive && live.mode === 'playing';
  const candidates = useMemo(() => (flow ? smartFillCandidates(flow.steps) : []), [flow]);
  const suggestable = candidates.filter((s) => s.value?.mode !== 'random' && (s.suggestions?.[0]?.confidence ?? 0) >= 0.5).length;
  const focusIndex = flow ? flow.steps.findIndex((s) => s.id === focusId) : -1;

  useHotkeys(
    {
      'mod+z': () => undo(),
      'mod+shift+z': () => redo(),
      'mod+y': () => redo(),
      'mod+s': () => void useEditor.getState().flushSave(),
      'mod+enter': () => flow && openRun(flow.id),
      'mod+d': () => duplicateSteps(useEditor.getState().selected),
      'mod+a': () => useEditor.getState().selectAll(),
      'mod+c': () => copySteps(useEditor.getState().selected),
      'mod+v': () => void pasteSteps(),
      delete: () => deleteSteps(useEditor.getState().selected),
      backspace: () => deleteSteps(useEditor.getState().selected),
      f5: () => !recording && !playing && void playInBrowser(0),
      'alt+arrowup': () => moveSelection(-1),
      'alt+arrowdown': () => moveSelection(1),
      arrowup: () => {
        const f = useEditor.getState().flow;
        const i = f ? f.steps.findIndex((s) => s.id === useEditor.getState().focusId) : -1;
        if (f && i > 0) useEditor.getState().select(f.steps[i - 1].id);
      },
      arrowdown: () => {
        const f = useEditor.getState().flow;
        const i = f ? f.steps.findIndex((s) => s.id === useEditor.getState().focusId) : -1;
        if (f && i < f.steps.length - 1) useEditor.getState().select(f.steps[i + 1].id);
      },
      escape: () => useEditor.getState().clearSelection(),
    },
    tab === 'steps' && !!flow,
  );

  if (loadError)
    return (
      <EmptyState icon={CircleAlert} title="This flow could not be opened" action={<Button onClick={() => navigate('/flows')}>Back to flows</Button>}>
        {loadError}
      </EmptyState>
    );
  if (!flow || flow.id !== id)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );

  const applySmart = (changes: Map<string, ValueSource | null>) => {
    if (!changes.size) return;
    update((f) => {
      for (const s of f.steps) {
        if (!changes.has(s.id)) continue;
        const v = changes.get(s.id);
        s.value = v ?? undefined;
      }
    });
    toast.success(`Updated ${changes.size} field${changes.size === 1 ? '' : 's'}`, 'Each run now fills them with new data. Press play to try it.');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => back('/flows')} />
        <div className="min-w-0 flex-1">
          <input
            value={flow.name}
            onChange={(e) => update((f) => void (f.name = e.target.value), { key: 'name' })}
            onBlur={(e) => !e.target.value.trim() && update((f) => void (f.name = 'Untitled flow'))}
            className="w-full max-w-[520px] truncate rounded-md bg-transparent px-1 text-[15px] font-semibold tracking-[-0.01em] text-ink outline-none hover:bg-raised/60 focus:bg-raised"
            aria-label="Flow name"
          />
          <div className="flex items-center gap-2 pl-1">
            <SaveIndicator />
            <span className="text-ink-3">·</span>
            <span className="text-[12px] text-ink-3">{flow.steps.length} steps</span>
            <TagEditor />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <IconButton icon={Undo2} label="Undo" shortcut="Ctrl Z" disabled={!past} onClick={undo} />
          <IconButton icon={Redo2} label="Redo" shortcut="Ctrl Y" disabled={!future} onClick={redo} />
        </div>
        <div className="mx-1 h-6 w-px bg-line" />

        {recording ? (
          <Button disabled>
            <CircleDot size={15} className="rec-pulse rounded-full text-rec" /> Recording
          </Button>
        ) : (
          <Menu
            align="end"
            trigger={
              <Button disabled={playing} iconRight={undefined}>
                <CircleDot size={15} className="text-rec" /> Record
              </Button>
            }
          >
            <MenuItem onSelect={() => void recordInto(flow, { insertAfter: 'end', replayUntil: flow.steps.length && !thisLive ? flow.steps.length - 1 : undefined })} hint={flow.steps.length && !thisLive ? 'Replays the flow first, then records' : undefined}>
              Record more at the end
            </MenuItem>
            <MenuItem disabled={focusIndex < 0} onSelect={() => void recordInto(flow, { insertAfter: flow.steps[focusIndex].id, replayUntil: thisLive ? undefined : focusIndex })} hint="New steps go after the selected step">
              Record after step {focusIndex + 1 || '…'}
            </MenuItem>
            {!flow.steps.length && <MenuItem onSelect={() => void recordInto(flow, { insertAfter: 'start' })}>Record from the start</MenuItem>}
          </Menu>
        )}

        <div className="flex">
          <Button className="rounded-r-none" icon={Play} disabled={recording || playing || !flow.steps.length} onClick={() => void playInBrowser(0)}>
            Play
          </Button>
          <Menu
            align="end"
            trigger={
              <Button className="rounded-l-none border-l-0 px-2" disabled={recording || playing || !flow.steps.length} aria-label="More playback options">
                <Ellipsis size={15} />
              </Button>
            }
          >
            <MenuItem icon={Play} shortcut="F5" onSelect={() => void playInBrowser(0)}>
              Play all steps
            </MenuItem>
            <MenuItem icon={StepForward} disabled={focusIndex < 0} onSelect={() => void playInBrowser(focusIndex)}>
              Play from selected step
            </MenuItem>
            <MenuItem icon={StepForward} disabled={focusIndex < 0} onSelect={() => void playInBrowser(0, focusIndex)}>
              Play up to selected step
            </MenuItem>
          </Menu>
        </div>
        <Tooltip content="Run many iterations with generated data" shortcut="Ctrl ↵">
          <Button variant="primary" icon={Play} onClick={() => openRun(flow.id)} disabled={recording || !flow.steps.length}>
            Run…
          </Button>
        </Tooltip>
        <Menu trigger={<IconButton icon={Ellipsis} label="Flow actions" />}>
          <MenuItem icon={Sparkles} onSelect={() => setSmartOpen(true)} disabled={!candidates.length}>
            Fill fields with generated data
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={Copy}
            onSelect={async () => {
              await useEditor.getState().flushSave();
              const copy = await api.flows.duplicate(flow.id);
              if (copy) navigate(`/flows/${copy.id}`);
            }}
          >
            Duplicate flow
          </MenuItem>
          <MenuItem
            icon={Download}
            onSelect={async () => {
              await useEditor.getState().flushSave();
              void exportFlow(flow.id, 'json');
            }}
          >
            Export flow file
          </MenuItem>
          <MenuItem
            icon={FileCode}
            onSelect={async () => {
              await useEditor.getState().flushSave();
              void exportFlow(flow.id, 'playwright');
            }}
          >
            Export as Playwright test
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            tone="danger"
            onSelect={async () => {
              if (await deleteFlow(flow)) {
                if (thisLive) void api.live.close();
                useEditor.getState().close();
                navigate('/flows');
              }
            }}
          >
            Delete flow
          </MenuItem>
        </Menu>
      </header>

      <LiveBar />

      <div className="flex shrink-0 items-center border-b border-line px-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'steps', label: 'Steps', count: flow.steps.length },
            { value: 'variables', label: 'Variables', count: flow.variables.length || undefined },
            { value: 'settings', label: 'Run settings' },
            { value: 'runs', label: 'Runs', count: flow.runCount || undefined },
          ]}
        />
      </div>

      <div className={cn('min-h-0 flex-1', tab === 'steps' ? 'flex' : 'block')}>
        {tab === 'steps' && (
          <>
            <div className="min-w-0 flex-1">
              <StepTrack onSmartFill={() => setSmartOpen(true)} smartCount={suggestable} />
            </div>
            <Inspector />
          </>
        )}
        {tab === 'variables' && <VariablesTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'runs' && <RunsTab />}
      </div>

      <SmartFillDialog open={smartOpen} onOpenChange={setSmartOpen} steps={flow.steps} onApply={applySmart} />
    </div>
  );
}
