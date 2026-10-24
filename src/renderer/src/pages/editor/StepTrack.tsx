import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppWindow, Copy, Ellipsis, Eye, EyeOff, Frame, GripVertical, Play, Plus, Search, Shuffle, Sparkles, StepForward, Trash2, CircleDot } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { dataTypeLabel, getDataType, sampleValues } from '@shared/data/catalog';
import { formatDuration } from '@shared/data/format';
import { STEP_GROUPS, STEP_META, isSecretStep, stepDetail, stepTitle } from '@shared/steps';
import type { Step, StepType } from '@shared/types';
import { Button, IconButton, Input, Menu, MenuItem, MenuSeparator, Popover, Tooltip, cn } from '@/components/ui';
import { STEP_ICONS, StepStatusIcon } from '@/components/visuals';
import { useApp } from '@/store/app';
import { useEditor, type StepRunState } from '@/store/editor';
import { recordInto } from '@/store/recording';
import { addStep, deleteSteps, duplicateSteps, moveStep, patchStep, playInBrowser, toggleEnabled } from './ops';

export function AddStepMenu({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[520px] p-2"
      trigger={
        trigger ?? (
          <Button size="sm" icon={Plus}>
            Add step
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-3 p-1">
        {STEP_GROUPS.map((g) => {
          const types = (Object.keys(STEP_META) as StepType[]).filter((t) => STEP_META[t].group === g.id && t !== 'uncheck');
          return (
            <div key={g.id}>
              <p className="px-2 pb-1 text-[11.5px] font-medium text-ink-3">{g.label}</p>
              {types.map((t) => {
                const Icon = STEP_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      addStep(t);
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised"
                  >
                    <Icon size={15} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink">{STEP_META[t].label}</span>
                      <span className="block text-[11.5px] leading-snug text-ink-3">{STEP_META[t].description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

const NODE_TONE: Record<string, string> = {
  running: 'border-accent bg-accent-soft text-accent',
  passed: 'border-pass/60 bg-pass-soft text-pass',
  failed: 'border-fail bg-fail-soft text-fail',
  warning: 'border-warn/70 bg-warn-soft text-warn',
  skipped: 'border-line text-ink-3',
  pending: 'border-warn bg-warn-soft text-warn',
};

interface RowProps {
  step: Step;
  index: number;
  selected: boolean;
  focused: boolean;
  status?: StepRunState;
  mask: boolean;
  locale: string;
  last: boolean;
  recordingHere: boolean;
  isRecording: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
}

const StepRow = memo(function StepRow({ step, index, selected, focused, status, mask, locale, last, recordingHere, isRecording, onSelect }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const Icon = STEP_ICONS[step.type];
  const random = step.value?.mode === 'random' ? step.value.dataType : undefined;
  const optionsKey = JSON.stringify(step.value?.options ?? {});
  const example = useMemo(() => {
    if (!random) return undefined;
    const def = getDataType(random);
    if (!def) return undefined;
    if (def.runtime) return def.description;
    if (mask && isSecretStep(step)) return 'e.g. ••••••••';
    try {
      return `e.g. ${sampleValues(random, step.value?.options, locale, 1, step.field)[0]}`;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [random, optionsKey, locale, mask]);
  const detail = example ?? stepDetail(step, mask);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focused || status?.status === 'running') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused, status?.status]);

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        ref.current = el;
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('step-enter relative', isDragging && 'z-10 opacity-80')}
    >
      <div
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        onMouseDown={(e) => onSelect(step.id, e)}
        className={cn(
          'group relative flex min-h-[54px] cursor-default items-stretch gap-0 rounded-lg pr-2 transition-colors',
          selected ? 'bg-accent-soft' : 'hover:bg-raised/60',
          focused && selected && 'ring-1 ring-accent-line',
          !step.enabled && 'opacity-55',
        )}
      >
        {/* Gutter: breakpoint and index */}
        <div className="flex w-[52px] shrink-0 items-center justify-end gap-1 pr-1">
          <button
            type="button"
            aria-label={step.breakpoint ? 'Remove breakpoint' : 'Pause here during playback'}
            title={step.breakpoint ? 'Remove breakpoint' : 'Pause here during playback'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => patchStep(step.id, { breakpoint: !step.breakpoint })}
            className={cn('flex h-4 w-4 items-center justify-center rounded-full', step.breakpoint ? 'text-rec' : 'text-transparent group-hover:text-line-strong hover:!text-rec/70')}
          >
            <CircleDot size={12} fill={step.breakpoint ? 'currentColor' : 'none'} />
          </button>
          <span className="tnum w-6 text-right text-[11.5px] text-ink-3">{index + 1}</span>
        </div>

        {/* Spine and node */}
        <div className="relative flex w-9 shrink-0 justify-center">
          <span className={cn('absolute top-0 w-px bg-line', index === 0 ? 'top-1/2' : '', last && !recordingHere ? 'bottom-1/2' : 'bottom-0')} />
          {status?.status === 'running' && <span className="absolute inset-y-0 w-0.5 rounded-full bg-accent" />}
          <span
            className={cn(
              'relative z-[1] mt-[13px] flex h-7 w-7 items-center justify-center rounded-full border bg-panel text-ink-2',
              status ? NODE_TONE[status.status] : 'border-line-strong',
              status?.status === 'running' && 'shadow-[0_0_0_4px_var(--accent-soft)]',
            )}
          >
            <Icon size={14} />
          </span>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate text-[13px] text-ink', !step.enabled && 'line-through')}>{stepTitle(step)}</span>
            {random && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[11px] leading-[18px] font-medium text-accent">
                <Shuffle size={11} /> {dataTypeLabel(random)}
              </span>
            )}
            {step.optional && <span className="shrink-0 rounded-md border border-line px-1.5 text-[11px] leading-[16px] text-ink-3">Optional</span>}
            {(step.tab ?? 0) > 0 && (
              <Tooltip content={`Runs in tab ${(step.tab ?? 0) + 1}`}>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-3">
                  <AppWindow size={12} /> {(step.tab ?? 0) + 1}
                </span>
              </Tooltip>
            )}
            {step.target?.framePath?.length ? (
              <Tooltip content="Inside an embedded frame">
                <Frame size={12} className="shrink-0 text-ink-3" />
              </Tooltip>
            ) : null}
          </div>
          {(detail || status?.error || status?.message) && (
            <div className="flex min-w-0 items-center gap-2">
              {status?.error ? (
                <span className="selectable truncate text-[12px] text-fail" title={status.error}>
                  {status.error}
                </span>
              ) : (
                <span className={cn('truncate text-[12px] text-ink-3', step.type !== 'press' && detail && !(example && getDataType(random)?.runtime) && 'font-mono text-[11.5px]')} title={detail}>
                  {status?.value && !isSecretStep(step) && step.value?.mode === 'random' ? `→ ${status.value}` : status?.message && !detail ? status.message : detail}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Status and actions */}
        <div className="flex shrink-0 items-center gap-1 pl-2">
          {status && status.status !== 'running' && status.duration !== undefined && <span className="tnum text-[11.5px] text-ink-3">{formatDuration(status.duration)}</span>}
          <StepStatusIcon status={status?.status} />
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 [[aria-selected=true]_&]:opacity-100">
            <IconButton size="sm" icon={Play} label="Play from here" onMouseDown={(e) => e.stopPropagation()} onClick={() => void playInBrowser(index)} disabled={isRecording} />
            <span {...attributes} {...listeners} onMouseDown={(e) => e.stopPropagation()} className="flex h-6 w-5 cursor-grab items-center justify-center text-ink-3 active:cursor-grabbing" aria-label="Drag to reorder">
              <GripVertical size={14} />
            </span>
          </div>
        </div>
      </div>
      {recordingHere && (
        <div className="relative flex h-8 items-center pl-[52px]">
          <div className="flex w-9 justify-center">
            <span className="rec-pulse h-3 w-3 rounded-full bg-rec" />
          </div>
          <span className="ml-2 text-[12px] font-medium text-rec">New steps appear here</span>
          <span className="ml-3 h-px flex-1 border-t border-dashed border-rec/50" />
        </div>
      )}
    </div>
  );
});

export function StepTrack({ onSmartFill, smartCount }: { onSmartFill: () => void; smartCount: number }) {
  const flow = useEditor((s) => s.flow)!;
  const selected = useEditor((s) => s.selected);
  const focusId = useEditor((s) => s.focusId);
  const statuses = useEditor((s) => s.statuses);
  const insertAfter = useEditor((s) => s.insertAfter);
  const select = useEditor((s) => s.select);
  const live = useApp((s) => s.live);
  const mask = useApp((s) => s.settings.maskSecrets);
  const locale = useApp((s) => s.settings.dataLocale);
  const [q, setQ] = useState('');
  const recording = live.flowId === flow.id && (live.mode === 'recording' || live.mode === 'paused');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flow.steps.map((s, i) => ({ s, i }));
    return flow.steps.map((s, i) => ({ s, i })).filter(({ s }) => `${stepTitle(s)} ${stepDetail(s, true)} ${s.note ?? ''}`.toLowerCase().includes(needle));
  }, [flow.steps, q]);

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) moveStep(String(e.active.id), String(e.over.id));
  };

  const onSelect = (id: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    select(id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
  };

  const recordAt = insertAfter === 'end' ? flow.steps[flow.steps.length - 1]?.id : insertAfter;
  const multi = selected.length > 1;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {multi ? (
          <>
            <span className="text-[13px] font-medium text-ink">{selected.length} steps selected</span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={StepForward} onClick={() => {
                const idx = flow.steps.map((s, i) => (selected.includes(s.id) ? i : -1)).filter((i) => i >= 0);
                void playInBrowser(Math.min(...idx), Math.max(...idx));
              }}>
                Play selection
              </Button>
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => toggleEnabled(selected)}>
                Turn on / off
              </Button>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => duplicateSteps(selected)}>
                Duplicate
              </Button>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => deleteSteps(selected)}>
                Delete
              </Button>
            </div>
          </>
        ) : (
          <>
            <Input icon={Search} inputSize="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter steps" className="w-[220px]" aria-label="Filter steps" />
            <div className="ml-auto flex items-center gap-1.5">
              {smartCount > 0 && (
                <Button size="sm" variant="subtle" icon={Sparkles} onClick={onSmartFill}>
                  Generated data
                  <span className="tnum rounded bg-accent/15 px-1 text-[11px]">{smartCount}</span>
                </Button>
              )}
              <AddStepMenu />
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-multiselectable="true" aria-label="Steps" data-hotkeys>
        {!flow.steps.length && !recording ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised text-ink-3">
              <span className="h-3 w-3 rounded-full bg-rec" />
            </div>
            <h3 className="text-[15px] font-semibold text-ink">This flow has no steps yet</h3>
            <p className="mt-1.5 max-w-[380px] text-[13px] text-ink-2">Record yourself using the site, or add steps by hand.</p>
            <div className="mt-5 flex gap-2">
              <Button variant="rec" onClick={() => void recordInto(flow, { insertAfter: 'end' })}>
                <span className="h-2.5 w-2.5 rounded-full bg-white" /> Start recording
              </Button>
              <AddStepMenu trigger={<Button icon={Plus}>Add a step</Button>} />
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filtered.map((x) => x.s.id)} strategy={verticalListSortingStrategy}>
              {recording && insertAfter === 'start' && (
                <div className="flex h-8 items-center pl-[52px]">
                  <div className="flex w-9 justify-center">
                    <span className="rec-pulse h-3 w-3 rounded-full bg-rec" />
                  </div>
                  <span className="ml-2 text-[12px] font-medium text-rec">New steps appear here</span>
                </div>
              )}
              {filtered.map(({ s, i }, k) => (
                <StepRow
                  key={s.id}
                  step={s}
                  index={i}
                  selected={selected.includes(s.id)}
                  focused={focusId === s.id}
                  status={statuses[s.id]}
                  mask={mask}
                  locale={locale}
                  last={k === filtered.length - 1}
                  recordingHere={recording && recordAt === s.id}
                  isRecording={recording}
                  onSelect={onSelect}
                />
              ))}
              {recording && !flow.steps.length && (
                <div className="flex h-10 items-center pl-[52px]">
                  <div className="flex w-9 justify-center">
                    <span className="rec-pulse h-3 w-3 rounded-full bg-rec" />
                  </div>
                  <span className="ml-2 text-[12px] font-medium text-rec">Waiting for your first action in the browser…</span>
                </div>
              )}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

export function StepMenu({ step, index }: { step: Step; index: number }) {
  const flow = useEditor((s) => s.flow)!;
  const live = useApp((s) => s.live);
  const recording = live.mode === 'recording' || live.mode === 'paused';
  return (
    <Menu trigger={<IconButton icon={Ellipsis} label="Step actions" />}>
      <MenuItem icon={Play} onSelect={() => void playInBrowser(index)} disabled={recording}>
        Play from this step
      </MenuItem>
      <MenuItem icon={StepForward} onSelect={() => void playInBrowser(index, index)} disabled={recording}>
        Play only this step
      </MenuItem>
      <MenuItem icon={CircleDot} onSelect={() => void recordInto(flow, { insertAfter: step.id, replayUntil: live.flowId === flow.id && live.mode === 'idle' ? undefined : index })} disabled={recording} hint="Replays up to here, then records new steps">
        Record from here
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={step.enabled ? EyeOff : Eye} onSelect={() => toggleEnabled([step.id])}>
        {step.enabled ? 'Turn off' : 'Turn on'}
      </MenuItem>
      <MenuItem icon={Copy} shortcut="Ctrl D" onSelect={() => duplicateSteps([step.id])}>
        Duplicate
      </MenuItem>
      <MenuItem icon={Trash2} tone="danger" shortcut="Del" onSelect={() => deleteSteps([step.id])}>
        Delete
      </MenuItem>
    </Menu>
  );
}
