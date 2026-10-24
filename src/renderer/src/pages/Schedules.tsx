import { CalendarClock, Ellipsis, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '@shared/data/format';
import { uid } from '@shared/defaults';
import type { RunOptions, Schedule, ScheduleKind } from '@shared/types';
import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, NumberInput, PageHeader, Segmented, Select, Switch, confirmDialog, cn } from '@/components/ui';
import { RunStatusBadge } from '@/components/visuals';
import { api, errorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { toast } from '@/store/toasts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case 'interval': {
      const m = s.everyMinutes ?? 60;
      return m % 60 === 0 ? `Every ${m === 60 ? 'hour' : `${m / 60} hours`}` : `Every ${m} minute${m === 1 ? '' : 's'}`;
    }
    case 'daily':
      return `Every day at ${s.time ?? '09:00'}`;
    case 'weekly':
      return `${(s.days ?? [1]).slice().sort().map((d) => DAYS[d]).join(', ')} at ${s.time ?? '09:00'}`;
    case 'cron':
      return `Cron: ${s.cron ?? ''}`;
    case 'once':
      return s.at ? `Once on ${new Date(s.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Once';
  }
}

function toLocalInput(t?: number) {
  const d = t ? new Date(t) : new Date(Date.now() + 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ScheduleDialog({ open, onOpenChange, initial, flowId }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Schedule; flowId?: string }) {
  const flows = useApp((s) => s.flows);
  const [s, setS] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setS(
      initial ?? {
        id: uid('sch'),
        flowId: flowId ?? flows[0]?.id ?? '',
        enabled: true,
        kind: 'daily',
        time: '09:00',
        days: [1, 2, 3, 4, 5],
        everyMinutes: 60,
        cron: '0 9 * * 1-5',
        createdAt: Date.now(),
        options: { iterations: 1, headless: true },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);
  if (!s) return null;
  const set = (p: Partial<Schedule>) => setS({ ...s, ...p });
  const setOpt = (p: Partial<RunOptions>) => setS({ ...s, options: { ...(s.options ?? {}), ...p } });

  const save = async () => {
    if (!s.flowId) return toast.warn('Choose a flow to schedule');
    setBusy(true);
    try {
      await api.schedules.save({ ...s, nextRunAt: undefined });
      toast.success(initial ? 'Schedule updated' : 'Schedule created', describeSchedule(s));
      onOpenChange(false);
    } catch (e) {
      toast.error('The schedule was not saved', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={CalendarClock}
      width={600}
      title={initial ? 'Edit schedule' : 'New schedule'}
      description="Scheduled runs start by themselves while Xero is running, including when its window is closed to the tray."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {initial ? 'Save schedule' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Flow">
            <Select value={s.flowId} onChange={(id) => set({ flowId: id })} options={flows.map((f) => ({ value: f.id, label: f.name, hint: f.domain }))} placeholder="Choose a flow" />
          </Field>
          <Field label="Name (optional)">
            <Input value={s.name ?? ''} onChange={(e) => set({ name: e.target.value || undefined })} placeholder="Morning smoke test" />
          </Field>
        </div>
        <Field label="Repeat">
          <Segmented
            value={s.kind}
            onChange={(k: ScheduleKind) => set({ kind: k })}
            options={[
              { value: 'interval', label: 'Every…' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'once', label: 'Once' },
              { value: 'cron', label: 'Cron' },
            ]}
            className="w-full"
          />
        </Field>
        {s.kind === 'interval' && (
          <Field label="Run every">
            <div className="flex items-center gap-2">
              <NumberInput value={s.everyMinutes ?? 60} min={1} max={10080} onChange={(n) => set({ everyMinutes: Math.round(n) })} className="w-36" suffix="min" />
              {[15, 30, 60, 240, 720].map((m) => (
                <button key={m} type="button" onClick={() => set({ everyMinutes: m })} className={cn('h-7 rounded-md px-2 text-[12px]', s.everyMinutes === m ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-raised')}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </button>
              ))}
            </div>
          </Field>
        )}
        {(s.kind === 'daily' || s.kind === 'weekly') && (
          <div className="flex items-end gap-4">
            <Field label="At">
              <Input type="time" value={s.time ?? '09:00'} onChange={(e) => set({ time: e.target.value })} className="w-32" />
            </Field>
            {s.kind === 'weekly' && (
              <Field label="On">
                <div className="flex gap-1">
                  {DAYS.map((d, i) => {
                    const on = s.days?.includes(i);
                    return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => set({ days: on ? (s.days ?? []).filter((x) => x !== i) : [...(s.days ?? []), i] })} className={cn('h-8 w-11 rounded-md border text-[12.5px]', on ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-ink-2 hover:text-ink')}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
          </div>
        )}
        {s.kind === 'once' && (
          <Field label="Date and time">
            <Input type="datetime-local" value={toLocalInput(s.at)} onChange={(e) => set({ at: new Date(e.target.value).getTime() })} className="w-60" />
          </Field>
        )}
        {s.kind === 'cron' && (
          <Field label="Cron expression" hint="Minute, hour, day of month, month, day of week. For example 0 9 * * 1-5 is 09:00 on weekdays.">
            <Input mono value={s.cron ?? ''} onChange={(e) => set({ cron: e.target.value })} />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-4 rounded-xl border border-line bg-raised/40 p-4">
          <Field label="Iterations">
            <NumberInput value={s.options?.iterations ?? 1} min={1} max={100000} onChange={(n) => setOpt({ iterations: Math.round(n) })} />
          </Field>
          <Field label="In parallel">
            <NumberInput value={s.options?.concurrency ?? 1} min={1} max={16} onChange={(n) => setOpt({ concurrency: Math.round(n) })} />
          </Field>
          <Field label="Window">
            <Segmented
              value={s.options?.headless === false ? 'visible' : 'bg'}
              onChange={(v) => setOpt({ headless: v === 'bg' })}
              options={[
                { value: 'bg', label: 'Hidden' },
                { value: 'visible', label: 'Visible' },
              ]}
              className="w-full"
            />
          </Field>
          <p className="col-span-3 text-[12px] text-ink-3">Other settings come from the flow’s Run settings tab.</p>
        </div>
        <Switch checked={s.enabled} onChange={(b) => set({ enabled: b })} label="Schedule is on" />
      </div>
    </Dialog>
  );
}

export function SchedulesPage() {
  const schedules = useApp((s) => s.schedules);
  const flows = useApp((s) => s.flows);
  const [editing, setEditing] = useState<Schedule | undefined>();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const edit = (s?: Schedule) => {
    setEditing(s);
    setOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Schedules"
        description="Run flows automatically, from every few minutes to once on a given date."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => edit()} disabled={!flows.length}>
            New schedule
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {!schedules.length ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            action={
              flows.length ? (
                <Button variant="primary" icon={Plus} onClick={() => edit()}>
                  Schedule a flow
                </Button>
              ) : (
                <Button onClick={() => navigate('/record')}>Record a flow first</Button>
              )
            }
          >
            Use schedules for daily smoke tests, data entry that repeats every hour, or a one-off run tonight.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            {schedules.map((s) => {
              const flow = flows.find((f) => f.id === s.flowId);
              return (
                <div key={s.id} className={cn('grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_150px_150px_50px_80px] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0', !s.enabled && 'opacity-60')}>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{s.name || flow?.name || 'Missing flow'}</p>
                    <p className="truncate text-[12px] text-ink-3">
                      {flow?.name ?? 'The flow was deleted'} · {s.options?.iterations ?? 1} iteration{(s.options?.iterations ?? 1) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="truncate text-[12.5px] text-ink-2">{describeSchedule(s)}</span>
                  <span className="text-[12.5px] text-ink-3">{s.enabled && s.nextRunAt ? `Next ${relativeTime(s.nextRunAt)}` : s.enabled ? 'Not planned' : 'Off'}</span>
                  <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
                    {s.lastRunAt ? (
                      <>
                        {s.lastStatus && <RunStatusBadge status={s.lastStatus} />}
                        <button type="button" className="hover:underline" onClick={() => s.lastRunId && navigate(`/runs/${s.lastRunId}`)}>
                          {relativeTime(s.lastRunAt)}
                        </button>
                      </>
                    ) : (
                      'Never ran'
                    )}
                  </span>
                  <Switch checked={s.enabled} onChange={(b) => void api.schedules.save({ ...s, enabled: b })} ariaLabel="Schedule on" />
                  <div className="flex justify-end">
                    <IconButton
                      icon={Play}
                      label="Run now"
                      tone="accent"
                      onClick={async () => {
                        const id = await api.schedules.runNow(s.id);
                        if (id) navigate(`/runs/${id}`);
                      }}
                    />
                    <Menu trigger={<IconButton icon={Ellipsis} label="More" />}>
                      <MenuItem icon={Pencil} onSelect={() => edit(s)}>
                        Edit
                      </MenuItem>
                      <MenuItem
                        icon={Trash2}
                        tone="danger"
                        onSelect={async () => {
                          if (await confirmDialog({ title: 'Delete this schedule?', confirm: 'Delete', tone: 'danger' })) await api.schedules.delete(s.id);
                        }}
                      >
                        Delete
                      </MenuItem>
                    </Menu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ScheduleDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
