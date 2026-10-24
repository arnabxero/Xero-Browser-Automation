import { Copy, FilePlus2, MousePointerClick, StickyNote, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { STEP_META, isSecretStep, stepTitle } from '@shared/steps';
import type { AssertKind, CompareOp, ExtractSource, Modifier, Step, ValueSource, WaitKind } from '@shared/types';
import { TemplateHelp, ValueEditor } from '@/components/ValueEditor';
import { Button, Field, IconButton, Input, NumberInput, Segmented, Select, Switch, Textarea, cn } from '@/components/ui';
import { STEP_ICONS, StepStatusIcon } from '@/components/visuals';
import { api } from '@/lib/api';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { deleteSteps, duplicateSteps, knownVariables, patchStep, toggleEnabled } from './ops';
import { StepMenu } from './StepTrack';
import { TargetEditor } from './TargetEditor';

function Block({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-b-0">
      {(title || aside) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="text-[12.5px] font-semibold text-ink-2">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const ASSERT_KINDS: { value: AssertKind; label: string; needsTarget: boolean; hasOp: boolean }[] = [
  { value: 'text', label: 'Element text', needsTarget: true, hasOp: true },
  { value: 'visible', label: 'Element is visible', needsTarget: true, hasOp: false },
  { value: 'hidden', label: 'Element is hidden or gone', needsTarget: true, hasOp: false },
  { value: 'value', label: 'Field value', needsTarget: true, hasOp: true },
  { value: 'checked', label: 'Box is checked', needsTarget: true, hasOp: false },
  { value: 'enabled', label: 'Element is enabled', needsTarget: true, hasOp: false },
  { value: 'attribute', label: 'Element attribute', needsTarget: true, hasOp: true },
  { value: 'count', label: 'Number of matches', needsTarget: true, hasOp: true },
  { value: 'url', label: 'Page URL', needsTarget: false, hasOp: true },
  { value: 'title', label: 'Page title', needsTarget: false, hasOp: true },
];

const OPS: { value: CompareOp; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'is exactly' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'notEquals', label: 'is not' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'matches', label: 'matches pattern' },
  { value: 'greaterThan', label: 'is greater than' },
  { value: 'lessThan', label: 'is less than' },
];

const WAIT_KINDS: { value: WaitKind; label: string }[] = [
  { value: 'visible', label: 'Element appears' },
  { value: 'hidden', label: 'Element disappears' },
  { value: 'attached', label: 'Element exists (even hidden)' },
  { value: 'detached', label: 'Element is removed' },
  { value: 'text', label: 'Text appears on the page' },
  { value: 'url', label: 'URL contains' },
  { value: 'load', label: 'Page finishes loading' },
  { value: 'networkIdle', label: 'Network goes quiet' },
];

const EXTRACT_SOURCES: { value: ExtractSource; label: string; needsTarget: boolean }[] = [
  { value: 'text', label: 'Visible text', needsTarget: true },
  { value: 'value', label: 'Field value', needsTarget: true },
  { value: 'attribute', label: 'An attribute', needsTarget: true },
  { value: 'html', label: 'Inner HTML', needsTarget: true },
  { value: 'count', label: 'Number of matches', needsTarget: true },
  { value: 'url', label: 'Page URL', needsTarget: false },
  { value: 'title', label: 'Page title', needsTarget: false },
];

function KeyCapture({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <div className="flex gap-2">
      <Input mono value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter, Control+A, Shift+Tab…" />
      <Button
        size="md"
        variant={listening ? 'subtle' : 'secondary'}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={(e) => {
          if (!listening) return;
          e.preventDefault();
          if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
          const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && e.key.length > 1 && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
          onChange([...mods, e.key === ' ' ? 'Space' : e.key].join('+'));
          setListening(false);
        }}
      >
        {listening ? 'Press a key…' : 'Record key'}
      </Button>
    </div>
  );
}

function StepFields({ step, index }: { step: Step; index: number }) {
  const flow = useEditor((s) => s.flow)!;
  const datasets = useApp((s) => s.datasets);
  const set = (patch: Partial<Step>, key?: string) => patchStep(step.id, patch, key);
  const vars = knownVariables(flow, index);
  const columns = [...new Set(datasets.flatMap((d) => d.columns))];
  const setValue = (v: ValueSource, key?: string) => set({ value: v }, key ? `value:${key}` : undefined);
  const meta = STEP_META[step.type];
  const target = (label?: string, optional?: string) => (
    <Block>
      <TargetEditor target={step.target} onChange={(t) => set({ target: t })} stepTab={step.tab} label={label} />
      {optional && !step.target && <p className="-mt-1 text-[12px] text-ink-3">{optional}</p>}
    </Block>
  );

  switch (step.type) {
    case 'navigate':
    case 'newTab':
      return (
        <Block title={step.type === 'navigate' ? 'Address' : 'Open at'}>
          <Field aside={<TemplateHelp onInsert={(t) => set({ url: `${step.url ?? ''}${t}` })} />}>
            <Input mono value={step.url ?? ''} onChange={(e) => set({ url: e.target.value }, 'url')} placeholder="https://example.com/{{var.path}}" />
          </Field>
        </Block>
      );
    case 'click':
      return (
        <>
          {target('Element to click')}
          <Block title="Click">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Button">
                <Segmented
                  value={step.button ?? 'left'}
                  onChange={(b) => set({ button: b === 'left' ? undefined : b })}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                    { value: 'middle', label: 'Middle' },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </Field>
              <Field label="Clicks">
                <Segmented
                  value={String(step.clickCount ?? 1)}
                  onChange={(c) => set({ clickCount: c === '1' ? undefined : Number(c) })}
                  options={[
                    { value: '1', label: 'Single' },
                    { value: '2', label: 'Double' },
                    { value: '3', label: 'Triple' },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </Field>
            </div>
            <Field label="Hold keys">
              <div className="flex gap-3">
                {(['Control', 'Shift', 'Alt'] as Modifier[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={step.modifiers?.includes(m) ?? false}
                      onChange={(e) => {
                        const next = e.target.checked ? [...(step.modifiers ?? []), m] : (step.modifiers ?? []).filter((x) => x !== m);
                        set({ modifiers: next.length ? next : undefined });
                      }}
                    />
                    {m === 'Control' ? 'Ctrl' : m}
                  </label>
                ))}
              </div>
            </Field>
          </Block>
        </>
      );
    case 'hover':
      return target('Element to hover');
    case 'fill':
      return (
        <>
          {target('Field')}
          <Block title="Text to enter">
            <ValueEditor value={step.value} onChange={setValue} field={step.field} suggestions={step.suggestions} secret={isSecretStep(step)} variables={vars} columns={columns} multiline={step.field?.multiline} />
          </Block>
        </>
      );
    case 'press':
      return (
        <>
          <Block title="Key">
            <KeyCapture value={step.key ?? ''} onChange={(k) => set({ key: k })} />
          </Block>
          {target('Focus this element first', 'Without an element the key goes to whatever has focus.')}
        </>
      );
    case 'select': {
      const v = step.value ?? { mode: 'static', static: step.select?.values[0] ?? '' };
      return (
        <>
          {target('Dropdown')}
          <Block title="Option">
            {v.mode === 'static' && step.select?.labels?.length ? (
              <p className="text-[12.5px] text-ink-2">
                Recorded: <span className="font-medium text-ink">{step.select.labels.join(', ')}</span>
              </p>
            ) : null}
            <ValueEditor value={v.mode === 'random' && !v.dataType ? { ...v, dataType: 'choice.option' } : v} onChange={setValue} field={step.field} suggestions={step.suggestions} variables={vars} columns={columns} />
            {step.field?.options?.length ? (
              <p className="text-[12px] leading-relaxed text-ink-3">
                Options: {step.field.options.filter((o) => o.value).slice(0, 8).map((o) => o.label).join(', ')}
                {step.field.options.length > 9 ? ` and ${step.field.options.length - 9} more` : ''}
              </p>
            ) : null}
            <p className="text-[12px] text-ink-3">Other values are matched to an option by value or label.</p>
          </Block>
        </>
      );
    }
    case 'check':
    case 'uncheck': {
      const radio = step.field?.type === 'radio' || step.target?.role === 'radio';
      const mode = step.value?.mode === 'random' ? 'random' : step.type;
      return (
        <>
          {target(radio ? 'Radio button' : 'Checkbox')}
          <Block title="State">
            <Segmented
              value={mode}
              onChange={(m) => {
                if (m === 'random') set({ value: { mode: 'random', dataType: radio ? 'choice.radio' : 'choice.checkbox' } });
                else set({ type: m as 'check' | 'uncheck', value: undefined });
              }}
              options={
                radio
                  ? [
                      { value: 'check', label: 'Select this one' },
                      { value: 'random', label: 'Random choice in group' },
                    ]
                  : [
                      { value: 'check', label: 'Checked' },
                      { value: 'uncheck', label: 'Unchecked' },
                      { value: 'random', label: 'Random' },
                    ]
              }
              size="sm"
              className="w-full"
            />
            {mode === 'random' && !radio && (
              <Field label="Chance of checking it">
                <NumberInput value={Number(step.value?.options?.probability ?? 50)} min={0} max={100} suffix="%" onChange={(n) => set({ value: { mode: 'random', dataType: 'choice.checkbox', options: { probability: n } } })} />
              </Field>
            )}
            <Switch checked={!!step.useClick} onChange={(b) => set({ useClick: b || undefined })} label="Click it instead (custom checkboxes)" />
          </Block>
        </>
      );
    }
    case 'upload':
      return (
        <>
          {target('File input or upload button')}
          <Block
            title="Files"
            aside={
              <Button
                size="sm"
                icon={FilePlus2}
                onClick={async () => {
                  const files = await api.app.chooseFiles({ multiple: true, title: 'Choose files to upload' });
                  if (files.length) set({ files: [...(step.files ?? []), ...files] });
                }}
              >
                Add files
              </Button>
            }
          >
            {step.files?.length ? (
              <ul className="flex flex-col gap-1">
                {step.files.map((f, i) => (
                  <li key={`${f}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
                    <span className="selectable min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={f}>
                      {f}
                    </span>
                    <IconButton size="sm" icon={X} label="Remove file" onClick={() => set({ files: step.files!.filter((_, j) => j !== i) })} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-3">No files chosen.</p>
            )}
          </Block>
        </>
      );
    case 'dragDrop':
      return (
        <>
          {target('Drag this')}
          <Block>
            <TargetEditor label="Drop onto" target={step.destination} onChange={(t) => set({ destination: t })} stepTab={step.tab} />
          </Block>
        </>
      );
    case 'scroll':
      return (
        <>
          <Block title="Scroll to">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Down (px)">
                <NumberInput value={step.scroll?.y ?? 0} min={0} max={100000} step={100} onChange={(n) => set({ scroll: { x: step.scroll?.x ?? 0, y: n, mode: step.scroll?.mode ?? 'window' } })} />
              </Field>
              <Field label="Across (px)">
                <NumberInput value={step.scroll?.x ?? 0} min={0} max={100000} step={100} onChange={(n) => set({ scroll: { y: step.scroll?.y ?? 0, x: n, mode: step.scroll?.mode ?? 'window' } })} />
              </Field>
            </div>
          </Block>
          {target('Scroll inside this element', 'Without an element the whole page scrolls.')}
        </>
      );
    case 'wait':
      return (
        <Block title="Duration">
          <NumberInput value={(step.duration ?? 1000) / 1000} min={0} max={3600} step={0.5} suffix="s" onChange={(n) => set({ duration: Math.round(n * 1000) })} />
          <p className="text-[12px] text-ink-3">Fixed waits are not affected by the run speed. Prefer “Wait for” when you can.</p>
        </Block>
      );
    case 'waitFor': {
      const w = step.waitFor ?? { kind: 'visible' as WaitKind };
      const needsTarget = ['visible', 'hidden', 'attached', 'detached'].includes(w.kind);
      return (
        <>
          <Block title="Wait until">
            <Select value={w.kind} onChange={(k) => set({ waitFor: { ...w, kind: k } })} options={WAIT_KINDS} />
            {(w.kind === 'url' || w.kind === 'text') && <Input mono value={w.value ?? ''} onChange={(e) => set({ waitFor: { ...w, value: e.target.value } }, 'wait')} placeholder={w.kind === 'url' ? '/checkout/complete' : 'Thank you for your order'} />}
          </Block>
          {needsTarget && target('Element')}
        </>
      );
    }
    case 'assert': {
      const a = step.assert ?? { kind: 'text' as AssertKind, op: 'contains' as CompareOp };
      const kind = ASSERT_KINDS.find((k) => k.value === a.kind) ?? ASSERT_KINDS[0];
      return (
        <>
          <Block title="Check">
            <Select value={a.kind} onChange={(k) => set({ assert: { ...a, kind: k } })} options={ASSERT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
            {a.kind === 'attribute' && <Input mono value={a.attribute ?? ''} placeholder="Attribute name, e.g. aria-expanded" onChange={(e) => set({ assert: { ...a, attribute: e.target.value } }, 'attr')} />}
            {kind.hasOp && (
              <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-2">
                <Select value={a.op} onChange={(op) => set({ assert: { ...a, op } })} options={OPS} />
                <Input value={a.expected ?? ''} onChange={(e) => set({ assert: { ...a, expected: e.target.value } }, 'expected')} placeholder={a.op === 'matches' ? '/order #\\d+/i' : 'Expected value or {{var.name}}'} />
              </div>
            )}
            {(a.kind === 'checked' || a.kind === 'enabled') && (
              <Segmented
                value={a.op === 'notEquals' ? 'no' : 'yes'}
                onChange={(v) => set({ assert: { ...a, op: v === 'no' ? 'notEquals' : 'equals' } })}
                options={[
                  { value: 'yes', label: a.kind === 'checked' ? 'Checked' : 'Enabled' },
                  { value: 'no', label: a.kind === 'checked' ? 'Not checked' : 'Disabled' },
                ]}
                size="sm"
              />
            )}
            <Switch checked={!!a.soft} onChange={(b) => set({ assert: { ...a, soft: b || undefined } })} label="Keep going if it fails (warning only)" />
          </Block>
          {kind.needsTarget && target('Element')}
        </>
      );
    }
    case 'extract': {
      const ex = step.extract ?? { source: 'text' as ExtractSource, variable: 'value' };
      const src = EXTRACT_SOURCES.find((s) => s.value === ex.source) ?? EXTRACT_SOURCES[0];
      return (
        <>
          <Block title="Save">
            <div className="grid grid-cols-2 gap-3">
              <Field label="What">
                <Select value={ex.source} onChange={(s) => set({ extract: { ...ex, source: s } })} options={EXTRACT_SOURCES.map((s) => ({ value: s.value, label: s.label }))} />
              </Field>
              <Field label="As variable">
                <Input mono value={ex.variable} onChange={(e) => set({ extract: { ...ex, variable: e.target.value.replace(/[^\w]/g, '') } }, 'var')} />
              </Field>
            </div>
            {ex.source === 'attribute' && <Input mono value={ex.attribute ?? ''} placeholder="href" onChange={(e) => set({ extract: { ...ex, attribute: e.target.value } }, 'attr')} />}
            <Field label="Keep only the part matching" hint="Optional pattern. With a group like (\d+), only the group is kept.">
              <Input mono value={ex.regex ?? ''} placeholder="Order #(\d+)" onChange={(e) => set({ extract: { ...ex, regex: e.target.value || undefined } }, 'regex')} />
            </Field>
            <p className="text-[12px] text-ink-3">
              Use it later as <span className="font-mono text-ink-2">{`{{var.${ex.variable}}}`}</span>
            </p>
          </Block>
          {src.needsTarget && target('Element')}
        </>
      );
    }
    case 'setVariable':
      return (
        <Block title="Variable">
          <Field label="Name">
            <Input mono value={step.variable ?? ''} onChange={(e) => set({ variable: e.target.value.replace(/[^\w]/g, '') }, 'name')} />
          </Field>
          <ValueEditor value={step.value} onChange={setValue} variables={vars} columns={columns} allowModes={['static', 'random', 'template', 'dataset', 'variable']} />
        </Block>
      );
    case 'screenshot':
      return (
        <>
          <Block title="Screenshot">
            <Field label="File name">
              <Input value={step.screenshot?.name ?? ''} placeholder="checkout-page" onChange={(e) => set({ screenshot: { ...step.screenshot, name: e.target.value } }, 'name')} />
            </Field>
            <Switch checked={!!step.screenshot?.fullPage} onChange={(b) => set({ screenshot: { ...step.screenshot, fullPage: b } })} label="Capture the whole page, not just the window" />
            <Switch checked={!!step.screenshot?.element} onChange={(b) => set({ screenshot: { ...step.screenshot, element: b } })} label="Only capture one element" />
            <p className="text-[12px] text-ink-3">Screenshots are saved with each run and shown in its report.</p>
          </Block>
          {step.screenshot?.element && target('Element')}
        </>
      );
    case 'script':
      return (
        <Block title="JavaScript">
          <Textarea mono rows={12} value={step.code ?? ''} onChange={(e) => set({ code: e.target.value }, 'code')} />
          <p className="text-[12px] leading-relaxed text-ink-3">
            Runs inside the page with an object <span className="font-mono text-ink-2">vars</span>. Use <span className="font-mono text-ink-2">await</span> freely and <span className="font-mono text-ink-2">return</span> a value to save it.
          </p>
          <Field label="Save the returned value as">
            <Input mono value={step.resultVariable ?? ''} placeholder="result" onChange={(e) => set({ resultVariable: e.target.value.replace(/[^\w]/g, '') || undefined }, 'rv')} />
          </Field>
        </Block>
      );
    case 'dialog':
      return (
        <Block title="Answer">
          {step.dialog?.message && <p className="selectable rounded-lg border border-line bg-sunken px-3 py-2 text-[12.5px] text-ink-2">“{step.dialog.message}”</p>}
          <Segmented
            value={step.dialog?.action ?? 'accept'}
            onChange={(a) => set({ dialog: { ...(step.dialog ?? { action: 'accept' }), action: a } })}
            options={[
              { value: 'accept', label: 'Accept (OK)' },
              { value: 'dismiss', label: 'Dismiss (Cancel)' },
            ]}
            size="sm"
          />
          {(step.dialog?.dialogType === 'prompt' || step.dialog?.promptText !== undefined) && (
            <Field label="Text to enter">
              <Input value={step.dialog?.promptText ?? ''} onChange={(e) => set({ dialog: { ...(step.dialog ?? { action: 'accept' }), promptText: e.target.value } }, 'prompt')} />
            </Field>
          )}
          <p className="text-[12px] text-ink-3">The answer is given to the next {step.dialog?.dialogType ?? 'dialog'} that opens, usually right after the previous step.</p>
        </Block>
      );
    default:
      return meta.needsTarget ? target() : <Block><p className="text-[12.5px] text-ink-3">{meta.description}. Nothing else to set.</p></Block>;
  }
}

export function Inspector() {
  const flow = useEditor((s) => s.flow)!;
  const focusId = useEditor((s) => s.focusId);
  const selected = useEditor((s) => s.selected);
  const status = useEditor((s) => (focusId ? s.statuses[focusId] : undefined));
  const index = flow.steps.findIndex((s) => s.id === focusId);
  const step = flow.steps[index];
  const [noteOpen, setNoteOpen] = useState(false);

  if (selected.length > 1) {
    return (
      <aside className="flex w-[400px] shrink-0 flex-col items-center justify-center gap-3 border-l border-line bg-panel px-8 text-center">
        <p className="text-[14px] font-semibold text-ink">{selected.length} steps selected</p>
        <p className="text-[12.5px] text-ink-3">Shift-click to extend, Ctrl-click to add or remove one.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => toggleEnabled(selected)}>
            Turn on / off
          </Button>
          <Button size="sm" icon={Copy} onClick={() => duplicateSteps(selected)}>
            Duplicate
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => deleteSteps(selected)}>
            Delete
          </Button>
        </div>
      </aside>
    );
  }

  if (!step) {
    return (
      <aside className="flex w-[400px] shrink-0 flex-col items-center justify-center gap-2 border-l border-line bg-panel px-10 text-center">
        <MousePointerClick size={22} className="text-ink-3" />
        <p className="text-[13.5px] font-medium text-ink">Select a step to edit it</p>
        <p className="text-[12.5px] text-ink-3">Change what it types, which element it uses, or how long it waits.</p>
      </aside>
    );
  }

  const Icon = STEP_ICONS[step.type];
  const set = (patch: Partial<Step>, key?: string) => patchStep(step.id, patch, key);

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Step details">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-2">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-ink-3">
            Step {index + 1} · {STEP_META[step.type].label}
          </p>
          <input
            className="w-full truncate bg-transparent text-[13.5px] font-medium text-ink outline-none placeholder:text-ink"
            value={step.label ?? ''}
            placeholder={stepTitle({ ...step, label: undefined })}
            onChange={(e) => set({ label: e.target.value || undefined }, 'label')}
            aria-label="Step name"
          />
        </div>
        <Switch checked={step.enabled} onChange={(b) => set({ enabled: b })} ariaLabel="Step is on" />
        <StepMenu step={step} index={index} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status && status.status !== 'running' && (
          <div className={cn('mx-5 mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5', status.status === 'failed' ? 'border-fail/40 bg-fail-soft' : status.status === 'warning' ? 'border-warn/40 bg-warn-soft' : 'border-line bg-raised/50')}>
            <StepStatusIcon status={status.status} className="mt-px shrink-0" />
            <div className="min-w-0 text-[12.5px]">
              <p className="font-medium text-ink">{status.status === 'failed' ? 'Failed on the last playback' : status.status === 'warning' ? 'Passed with a warning' : status.status === 'passed' ? 'Passed on the last playback' : status.status === 'pending' ? 'Paused before this step' : 'Skipped'}</p>
              {status.error && <p className="selectable mt-0.5 break-words text-ink-2">{status.error}</p>}
              {status.message && !status.error && <p className="selectable mt-0.5 break-words text-ink-2">{status.message}</p>}
              {status.value && !isSecretStep(step) && <p className="selectable mt-0.5 truncate font-mono text-[11.5px] text-ink-3">Used: {status.value}</p>}
            </div>
          </div>
        )}

        <StepFields step={step} index={index} />

        <Block title="Behavior">
          <Switch checked={!!step.optional} onChange={(b) => set({ optional: b || undefined })} label="Optional: keep going if this step fails" />
          <Switch checked={!!step.breakpoint} onChange={(b) => set({ breakpoint: b || undefined })} label="Pause here when playing in the browser" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wait for element up to">
              <NumberInput value={(step.timeout ?? 0) / 1000} min={0} max={600} suffix="s" onChange={(n) => set({ timeout: n > 0 ? Math.round(n * 1000) : undefined })} ariaLabel="Timeout in seconds, 0 uses the run setting" />
            </Field>
            <Field label="Pause before">
              <NumberInput value={(step.delayBefore ?? 0) / 1000} min={0} max={600} step={0.5} suffix="s" onChange={(n) => set({ delayBefore: n > 0 ? Math.round(n * 1000) : undefined })} ariaLabel="Pause before in seconds" />
            </Field>
            <Field label="Retries">
              <NumberInput value={step.retries ?? -1} min={-1} max={10} onChange={(n) => set({ retries: n >= 0 ? n : undefined })} ariaLabel="Retries, -1 uses the run setting" />
            </Field>
            <Field label="Tab">
              <NumberInput value={(step.tab ?? 0) + 1} min={1} max={20} onChange={(n) => set({ tab: n > 1 ? n - 1 : undefined })} ariaLabel="Browser tab" />
            </Field>
          </div>
          <p className="text-[12px] text-ink-3">0 s and −1 retries use the values from the run settings.</p>
        </Block>

        <Block>
          {noteOpen || step.note ? (
            <Field label="Note">
              <Textarea rows={3} value={step.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined }, 'note')} placeholder="Why this step exists, what to watch out for…" />
            </Field>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="flex items-center gap-1.5 self-start text-[12.5px] text-ink-3 hover:text-accent">
              <StickyNote size={14} /> Add a note
            </button>
          )}
          {step.pageUrl && (
            <p className="truncate text-[11.5px] text-ink-3" title={step.pageUrl}>
              Recorded on <span className="font-mono">{step.pageUrl}</span>
            </p>
          )}
        </Block>
      </div>
    </aside>
  );
}
