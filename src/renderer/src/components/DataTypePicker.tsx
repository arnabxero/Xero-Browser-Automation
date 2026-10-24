import { Command } from 'cmdk';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CATEGORIES, DATA_TYPES, getDataType, sampleValues } from '@shared/data/catalog';
import type { FieldInfo, FieldSuggestion } from '@shared/types';
import { useApp } from '@/store/app';
import { CATEGORY_ICONS } from './visuals';
import { Popover, cn } from './ui';

export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? 'bg-pass' : pct >= 50 ? 'bg-accent' : 'bg-ink-3';
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={`${pct}% confident`}>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-line">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum text-[11.5px] text-ink-3">{pct}%</span>
    </span>
  );
}

export function DataTypeLabel({ id, className }: { id?: string; className?: string }) {
  const def = getDataType(id);
  if (!def) return <span className={cn('text-ink-3', className)}>Choose a data type</span>;
  const Icon = CATEGORY_ICONS[def.category];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Icon size={14} className="shrink-0 text-accent" />
      <span className="truncate">{def.label}</span>
    </span>
  );
}

export function DataTypePicker({
  value,
  onChange,
  suggestions,
  field,
  trigger,
  align = 'start',
}: {
  value?: string;
  onChange: (id: string) => void;
  suggestions?: FieldSuggestion[];
  field?: FieldInfo;
  trigger?: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const locale = useApp((s) => s.settings.dataLocale);
  const emailDomain = useApp((s) => s.settings.emailDomain);
  const samples = useMemo(() => {
    if (!open) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const d of DATA_TYPES) {
      try {
        m.set(d.id, sampleValues(d.id, undefined, locale, 1, field, emailDomain)[0] ?? '');
      } catch {
        m.set(d.id, '');
      }
    }
    return m;
  }, [open, locale, field, emailDomain]);

  const sugg = (suggestions ?? []).filter((s) => getDataType(s.dataType));
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const row = (id: string, extra?: ReactNode) => {
    const def = getDataType(id)!;
    const Icon = CATEGORY_ICONS[def.category];
    const sample = samples.get(id);
    return (
      <Command.Item
        key={`${extra ? 's' : 'c'}-${id}`}
        value={`${extra ? 'suggested ' : ''}${def.label} ${def.description} ${def.keywords ?? ''} ${def.category} ${id}`}
        onSelect={() => pick(id)}
        className={cn('flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 data-[selected=true]:bg-raised', value === id && 'bg-accent-soft')}
      >
        <Icon size={15} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] text-ink">{def.label}</span>
            {extra}
          </span>
          <span className="block truncate font-mono text-[11px] text-ink-3">{sample || def.description}</span>
        </span>
      </Command.Item>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      className="w-[420px] overflow-hidden p-0"
      trigger={
        trigger ?? (
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 text-left text-[13px] text-ink hover:border-line-strong focus:border-accent focus:outline-none data-[state=open]:border-accent"
          >
            <DataTypeLabel id={value} className="flex-1" />
            <ChevronDown size={14} className="text-ink-3" />
          </button>
        )
      }
    >
      <Command loop label="Data types">
        <Command.Input autoFocus placeholder="Search 80+ data types…" className="h-11 w-full border-b border-line bg-transparent px-3.5 text-[13px] text-ink outline-none placeholder:text-ink-3" />
        <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">No data type matches.</Command.Empty>
          {sugg.length > 0 && (
            <Command.Group
              heading={
                <span className="flex items-center gap-1.5">
                  <Sparkles size={12} /> Suggested for this field
                </span>
              }
              className="text-[11.5px] font-medium text-ink-3 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1"
            >
              {sugg.map((s) => row(s.dataType, <ConfidenceMeter value={s.confidence} className="ml-auto" />))}
            </Command.Group>
          )}
          {CATEGORIES.map((cat) => {
            const items = DATA_TYPES.filter((d) => d.category === cat.id);
            if (!items.length) return null;
            return (
              <Command.Group key={cat.id} heading={cat.label} className="text-[11.5px] font-medium text-ink-3 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1">
                {items.map((d) => row(d.id))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </Popover>
  );
}
