import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDataType, sampleValues } from '@shared/data/catalog';
import { fieldLabel } from '@shared/data/detect';
import { isInputStep } from '@shared/steps';
import type { Step, ValueSource } from '@shared/types';
import { useApp } from '@/store/app';
import { ConfidenceMeter, DataTypePicker } from './DataTypePicker';
import { Button, Dialog, cn } from './ui';
import { STEP_ICONS } from './visuals';

interface Row {
  step: Step;
  include: boolean;
  dataType?: string;
}

const CONSENT = /\b(agree|terms|consent|privacy|accept|policy|gdpr|subscribe|newsletter|remember me|keep me signed)\b/i;

function defaultRow(step: Step): Row {
  const top = step.suggestions?.[0];
  const current = step.value?.mode === 'random' ? step.value.dataType : undefined;
  const dataType = current ?? top?.dataType;
  const label = `${step.field?.label ?? ''} ${step.target?.description ?? ''}`;
  let include = !!current || (!!top && top.confidence >= 0.6);
  if (step.type === 'check' || step.type === 'uncheck') include = !!current || (dataType === 'choice.radio' && !CONSENT.test(label) && (top?.confidence ?? 0) >= 0.6);
  if (CONSENT.test(label) && !current) include = false;
  if (dataType === 'text.words' && !current) include = false;
  return { step, include, dataType };
}

export function smartFillCandidates(steps: Step[]): Step[] {
  return steps.filter((s) => s.enabled && isInputStep(s) && (s.field || s.suggestions?.length));
}

export function SmartFillDialog({ open, onOpenChange, steps, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; steps: Step[]; onApply: (changes: Map<string, ValueSource | null>) => void }) {
  const locale = useApp((s) => s.settings.dataLocale);
  const emailDomain = useApp((s) => s.settings.emailDomain);
  const candidates = useMemo(() => smartFillCandidates(steps), [steps]);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (open) setRows(candidates.map(defaultRow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.step.id === id ? { ...r, ...patch } : r)));
  const included = rows.filter((r) => r.include && r.dataType).length;

  const apply = () => {
    const changes = new Map<string, ValueSource | null>();
    for (const r of rows) {
      const prev = r.step.value;
      if (r.include && r.dataType) {
        changes.set(r.step.id, { ...(prev ?? { mode: 'random' }), mode: 'random', dataType: r.dataType, options: prev?.dataType === r.dataType ? prev.options : undefined, static: prev?.static });
      } else if (!r.include && prev?.mode === 'random') {
        changes.set(r.step.id, r.step.type === 'check' || r.step.type === 'uncheck' ? null : { ...prev, mode: 'static' });
      }
    }
    onApply(changes);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Sparkles}
      width={880}
      title="Fill fields with generated data"
      description="Each field was matched to a data type from its label, attributes and the value you typed. Check the matches, change any of them, then apply. Generated names, emails and addresses agree with each other within an iteration."
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-ink-3">
            {included} of {rows.length} field{rows.length === 1 ? '' : 's'} will use generated data
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={Sparkles} onClick={apply} disabled={!rows.length}>
            Apply to {included} field{included === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!rows.length ? (
        <p className="py-8 text-center text-[13px] text-ink-3">This flow has no form fields yet. Record yourself filling in a form first.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[28px_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)_minmax(0,1fr)] items-center gap-3 border-b border-line bg-raised px-3 py-2 text-[11.5px] font-medium text-ink-3">
            <input
              type="checkbox"
              aria-label="Select all"
              className="accent-[var(--accent)]"
              checked={rows.every((r) => r.include)}
              onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked && !!r.dataType })))}
            />
            <span>Field</span>
            <span>Recorded value</span>
            <span>Data type</span>
            <span>Example</span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {rows.map((r) => {
              const Icon = STEP_ICONS[r.step.type];
              const top = r.step.suggestions?.find((s) => s.dataType === r.dataType);
              const secret = r.step.field?.type === 'password';
              const recorded = r.step.type === 'select' ? (r.step.select?.labels.join(', ') ?? '') : r.step.type === 'check' ? 'checked' : r.step.type === 'uncheck' ? 'unchecked' : (r.step.value?.static ?? '');
              let sample = '';
              if (r.dataType) {
                const def = getDataType(r.dataType);
                sample = def?.runtime ? (def.runtime === 'select' ? 'Random real option' : def.runtime === 'radio' ? 'Random choice' : 'Random on / off') : (sampleValues(r.dataType, undefined, locale, 1, r.step.field, emailDomain)[0] ?? '');
              }
              return (
                <div key={r.step.id} className={cn('grid grid-cols-[28px_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)_minmax(0,1fr)] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0', !r.include && 'opacity-60')}>
                  <input type="checkbox" aria-label={`Use generated data for ${fieldLabel(r.step.field)}`} className="accent-[var(--accent)]" checked={r.include} onChange={(e) => set(r.step.id, { include: e.target.checked })} disabled={!r.dataType} />
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={14} className="shrink-0 text-ink-3" />
                    <span className="truncate text-[13px] text-ink" title={r.step.target?.description}>
                      {fieldLabel(r.step.field, r.step.target?.description)}
                    </span>
                  </div>
                  <span className="selectable truncate font-mono text-[12px] text-ink-2" title={secret ? undefined : recorded}>
                    {secret ? '••••••••' : recorded || '∅'}
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <DataTypePicker value={r.dataType} suggestions={r.step.suggestions} field={r.step.field} onChange={(id) => set(r.step.id, { dataType: id, include: true })} />
                    </div>
                    {top && <ConfidenceMeter value={top.confidence} />}
                  </div>
                  <span className="selectable truncate font-mono text-[12px] text-ink-3" title={sample}>
                    {sample}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
