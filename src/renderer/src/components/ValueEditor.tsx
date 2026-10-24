import { Braces, Database, Eye, EyeOff, PenLine, RefreshCw, Shuffle, Sparkles, Variable as VariableIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dataTypeLabel, defaultOptions, getDataType, sampleValues, type DataOption, type DataTypeDef } from '@shared/data/catalog';
import { TEMPLATE_HELP, hasTemplate, renderTemplate } from '@shared/template';
import { createGeneratorScope, generateValue } from '@shared/data/catalog';
import type { FieldInfo, FieldSuggestion, ValueMode, ValueSource } from '@shared/types';
import { useApp } from '@/store/app';
import { ConfidenceMeter, DataTypePicker } from './DataTypePicker';
import { Button, Field, IconButton, Input, NumberInput, Popover, Segmented, Select, Switch, Textarea, cn } from './ui';

export function DataOptionsForm({ def, options, onChange, field }: { def: DataTypeDef; options?: Record<string, unknown>; onChange: (o: Record<string, unknown>) => void; field?: FieldInfo }) {
  const opts = { ...defaultOptions(def), ...(options ?? {}) };
  const set = (key: string, v: unknown) => onChange({ ...(options ?? {}), [key]: v });
  const list = (def.options ?? []).filter((o) => !(o.key === 'format' && field?.type && ['date', 'datetime-local', 'time', 'month'].includes(field.type)));
  if (!list.length) return null;
  const control = (o: DataOption) => {
    const v = opts[o.key];
    switch (o.kind) {
      case 'boolean':
        return <Switch checked={!!v} onChange={(b) => set(o.key, b)} label={o.label} />;
      case 'number':
        return (
          <Field label={o.label} hint={o.help}>
            <NumberInput value={Number(v ?? o.default)} min={o.min} max={o.max} onChange={(n) => set(o.key, n)} ariaLabel={o.label} />
          </Field>
        );
      case 'select':
        return (
          <Field label={o.label} hint={o.help}>
            <Select value={String(v ?? o.default)} onChange={(x) => set(o.key, x)} options={(o.choices ?? []).map((c) => ({ value: c.value, label: c.label }))} ariaLabel={o.label} />
          </Field>
        );
      case 'textarea':
        return (
          <Field label={o.label} hint={o.help}>
            <Textarea value={String(v ?? '')} onChange={(e) => set(o.key, e.target.value)} rows={4} />
          </Field>
        );
      default:
        return (
          <Field label={o.label} hint={o.help}>
            <Input value={String(v ?? '')} placeholder={o.placeholder} onChange={(e) => set(o.key, e.target.value)} />
          </Field>
        );
    }
  };
  const bools = list.filter((o) => o.kind === 'boolean');
  const others = list.filter((o) => o.kind !== 'boolean');
  return (
    <div className="flex flex-col gap-3">
      {others.length > 0 && <div className="grid grid-cols-2 gap-3 [&>*:has(textarea)]:col-span-2">{others.map((o) => <div key={o.key}>{control(o)}</div>)}</div>}
      {bools.map((o) => (
        <div key={o.key}>
          {control(o)}
          {o.help && <p className="mt-1 text-[12px] text-ink-3">{o.help}</p>}
        </div>
      ))}
    </div>
  );
}

export function SamplePreview({ dataType, options, field, count = 3 }: { dataType: string; options?: Record<string, unknown>; field?: FieldInfo; count?: number }) {
  const locale = useApp((s) => s.settings.dataLocale);
  const emailDomain = useApp((s) => s.settings.emailDomain);
  const [seed, setSeed] = useState(0);
  const values = useMemo(() => {
    try {
      return sampleValues(dataType, options, locale, count, field, emailDomain);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType, JSON.stringify(options), locale, seed, field, emailDomain, count]);
  const def = getDataType(dataType);
  if (def?.runtime) {
    return <p className="text-[12px] leading-snug text-ink-3">{def.runtime === 'select' ? 'Picks one of the dropdown’s real options at run time, skipping placeholders like “Select…”.' : def.runtime === 'radio' ? 'Picks one of the radio buttons in the same group at run time.' : 'Decides on each run whether to tick the box.'}</p>;
  }
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="selectable max-w-full truncate rounded-md border border-line bg-sunken px-2 py-0.5 font-mono text-[11.5px] text-ink-2" title={v}>
            {v || '∅'}
          </span>
        ))}
      </div>
      <IconButton icon={RefreshCw} label="New samples" size="sm" onClick={() => setSeed((x) => x + 1)} />
    </div>
  );
}

const MODES: { value: ValueMode; label: string; icon: typeof Shuffle; title: string }[] = [
  { value: 'static', label: 'Fixed', icon: PenLine, title: 'Always type the same text' },
  { value: 'random', label: 'Random', icon: Shuffle, title: 'Generate realistic data on every run' },
  { value: 'dataset', label: 'Dataset', icon: Database, title: 'Take the value from a dataset column' },
  { value: 'variable', label: 'Variable', icon: VariableIcon, title: 'Use a variable saved earlier' },
  { value: 'template', label: 'Template', icon: Braces, title: 'Mix text, variables and generated values' },
];

export function TemplateHelp({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <Popover
      align="end"
      className="w-[380px] p-2"
      trigger={
        <button type="button" className="text-[12px] font-medium text-accent hover:underline">
          Insert…
        </button>
      }
    >
      <div className="flex flex-col">
        {TEMPLATE_HELP.map((t) => (
          <button key={t.token} type="button" onClick={() => onInsert(t.token)} className="rounded-md px-2 py-1.5 text-left hover:bg-raised">
            <span className="block font-mono text-[12px] text-accent">{t.token}</span>
            <span className="block text-[12px] text-ink-3">{t.description}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function TemplatePreview({ template, vars }: { template: string; vars: Record<string, string> }) {
  const locale = useApp((s) => s.settings.dataLocale);
  const preview = useMemo(() => {
    const scope = createGeneratorScope(locale, { iteration: 1 });
    try {
      return renderTemplate(template, { vars, persona: scope.persona, iteration: 1, row: {}, gen: (id) => generateValue(id, undefined, scope) });
    } catch {
      return '';
    }
  }, [template, vars, locale]);
  if (!hasTemplate(template)) return null;
  return (
    <p className="text-[12px] text-ink-3">
      Preview: <span className="selectable font-mono text-ink-2">{preview || '∅'}</span>
    </p>
  );
}

export function ValueEditor({
  value,
  onChange,
  field,
  suggestions,
  secret,
  variables,
  columns,
  multiline,
  allowModes,
}: {
  value?: ValueSource;
  onChange: (v: ValueSource, key?: string) => void;
  field?: FieldInfo;
  suggestions?: FieldSuggestion[];
  secret?: boolean;
  variables: string[];
  columns: string[];
  multiline?: boolean;
  allowModes?: ValueMode[];
}) {
  const v: ValueSource = value ?? { mode: 'static', static: '' };
  const [reveal, setReveal] = useState(false);
  const mask = useApp((s) => s.settings.maskSecrets) && secret && !reveal;
  const top = suggestions?.[0];
  const modes = allowModes ? MODES.filter((m) => allowModes.includes(m.value)) : MODES;

  const setMode = (mode: ValueMode) => {
    const next: ValueSource = { ...v, mode };
    if (mode === 'random' && !v.dataType && top) next.dataType = top.dataType;
    if (mode === 'template' && !v.template) next.template = v.static ?? '';
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented value={v.mode} onChange={setMode} options={modes.map(({ icon: _i, ...m }) => m)} size="sm" ariaLabel="Value source" className="w-full" />

      {v.mode === 'static' && (
        <div className="flex flex-col gap-2">
          <div className="relative">
            {multiline ? (
              <Textarea value={v.static ?? ''} onChange={(e) => onChange({ ...v, static: e.target.value }, 'static')} rows={3} />
            ) : (
              <Input type={mask ? 'password' : 'text'} value={v.static ?? ''} onChange={(e) => onChange({ ...v, static: e.target.value }, 'static')} className={secret ? 'pr-9' : undefined} />
            )}
            {secret && !multiline && (
              <button type="button" aria-label={reveal ? 'Hide value' : 'Show value'} onClick={() => setReveal((r) => !r)} className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink">
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
          </div>
          {top && top.confidence >= 0.35 && (
            <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="shrink-0 text-accent" />
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  Looks like <span className="font-semibold">{dataTypeLabel(top.dataType)}</span>
                </p>
                <ConfidenceMeter value={top.confidence} />
              </div>
              <div className="flex items-center gap-2 pl-[23px]">
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3" title={top.reasons.join(' · ')}>
                  Based on {top.reasons.slice(0, 2).join(', ')}
                </p>
                <Button size="sm" variant="primary" icon={Shuffle} onClick={() => onChange({ ...v, mode: 'random', dataType: top.dataType })}>
                  Generate it
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {v.mode === 'random' && <RandomEditor v={v} onChange={onChange} field={field} suggestions={suggestions} />}

      {v.mode === 'dataset' && (
        <Field label="Column" hint="Pick the dataset when you start a run. Each iteration uses the next row.">
          {columns.length ? (
            <Select value={v.column} onChange={(c) => onChange({ ...v, column: c })} options={columns.map((c) => ({ value: c, label: c }))} placeholder="Choose a column" />
          ) : (
            <Input value={v.column ?? ''} placeholder="Column name, e.g. Email" onChange={(e) => onChange({ ...v, column: e.target.value }, 'column')} />
          )}
        </Field>
      )}

      {v.mode === 'variable' && (
        <Field label="Variable" hint={variables.length ? 'Variables come from the Variables tab and from earlier “Save value” steps.' : 'No variables yet. Add one in the Variables tab or save a value with an earlier step.'}>
          {variables.length ? (
            <Select value={v.variable} onChange={(x) => onChange({ ...v, variable: x })} options={variables.map((x) => ({ value: x, label: x }))} placeholder="Choose a variable" />
          ) : (
            <Input value={v.variable ?? ''} mono placeholder="variableName" onChange={(e) => onChange({ ...v, variable: e.target.value }, 'variable')} />
          )}
        </Field>
      )}

      {v.mode === 'template' && (
        <Field label="Template" aside={<TemplateHelp onInsert={(t) => onChange({ ...v, template: `${v.template ?? ''}${t}` })} />}>
          <Textarea mono rows={2} value={v.template ?? ''} placeholder="{{persona.firstName}}-{{int:100:999}}@example.com" onChange={(e) => onChange({ ...v, template: e.target.value }, 'template')} />
          <TemplatePreview template={v.template ?? ''} vars={Object.fromEntries(variables.map((x) => [x, `‹${x}›`]))} />
        </Field>
      )}

      <SaveAs v={v} onChange={onChange} />
    </div>
  );
}

function RandomEditor({ v, onChange, field, suggestions }: { v: ValueSource; onChange: (v: ValueSource, key?: string) => void; field?: FieldInfo; suggestions?: FieldSuggestion[] }) {
  const def = getDataType(v.dataType);
  const top = suggestions?.[0];
  return (
    <div className="flex flex-col gap-3">
      <Field label="Data type">
        <DataTypePicker value={v.dataType} suggestions={suggestions} field={field} onChange={(id) => onChange({ ...v, dataType: id, options: undefined })} />
      </Field>
      {top && v.dataType !== top.dataType && top.confidence >= 0.5 && (
        <button type="button" onClick={() => onChange({ ...v, dataType: top.dataType, options: undefined })} className="flex items-center gap-2 self-start text-[12px] text-accent hover:underline">
          <Sparkles size={13} /> Suggested: {dataTypeLabel(top.dataType)} ({Math.round(top.confidence * 100)}%)
        </button>
      )}
      {def && (
        <>
          <SamplePreview dataType={def.id} options={v.options} field={field} />
          <DataOptionsForm def={def} options={v.options} field={field} onChange={(o) => onChange({ ...v, options: o }, 'options')} />
        </>
      )}
      {v.static && (
        <p className="text-[12px] text-ink-3">
          Recorded value: <span className="selectable font-mono text-ink-2">{field?.type === 'password' ? '••••••••' : v.static}</span>{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => onChange({ ...v, mode: 'static' })}>
            Use it instead
          </button>
        </p>
      )}
    </div>
  );
}

function SaveAs({ v, onChange }: { v: ValueSource; onChange: (v: ValueSource, key?: string) => void }) {
  const [open, setOpen] = useState(!!v.saveAs);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn('self-start text-[12px] text-ink-3 hover:text-accent')}>
        + Save the typed value as a variable
      </button>
    );
  return (
    <Field label="Save as variable" hint="Later steps can reuse the exact value, e.g. to confirm an email or log in again.">
      <Input mono value={v.saveAs ?? ''} placeholder="e.g. email" onChange={(e) => onChange({ ...v, saveAs: e.target.value.replace(/[^\w]/g, '') || undefined }, 'saveAs')} />
    </Field>
  );
}
