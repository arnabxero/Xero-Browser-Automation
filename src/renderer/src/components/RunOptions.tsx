import { ChevronDown, ChevronRight, Database, Eye, Gauge, KeyRound, Monitor, MonitorPlay, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDuration } from '@shared/data/format';
import { LOCALES } from '@shared/data/locales';
import { SPEED_PRESETS, mergeRunOptions } from '@shared/defaults';
import type { RunOptions } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { toast } from '@/store/toasts';
import { useUi } from '@/store/ui';
import { Button, Dialog, Field, Input, NumberInput, Segmented, Select, Switch, Textarea, cn } from './ui';

function Group({ icon: Icon, title, children }: { icon: typeof Gauge; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
        <Icon size={14} className="text-ink-3" />
        {title}
      </h3>
      {children}
    </section>
  );
}

const VIEWPORTS: { value: string; label: string }[] = [
  { value: 'window', label: 'Match the window' },
  { value: '1366x768', label: 'Laptop · 1366 × 768' },
  { value: '1920x1080', label: 'Desktop · 1920 × 1080' },
  { value: '1280x800', label: 'Small desktop · 1280 × 800' },
  { value: '820x1180', label: 'Tablet · 820 × 1180' },
  { value: '390x844', label: 'Phone · 390 × 844' },
];

export function RunOptionsForm({ value, onChange, compact }: { value: RunOptions; onChange: (patch: Partial<RunOptions>) => void; compact?: boolean }) {
  const datasets = useApp((s) => s.datasets);
  const sessions = useApp((s) => s.sessions);
  const browsers = useApp((s) => s.browsers);
  const [advanced, setAdvanced] = useState(false);
  const o = value;
  const ds = datasets.find((d) => d.id === o.datasetId);
  const viewportKey = o.viewport ? `${o.viewport.width}x${o.viewport.height}` : 'window';
  const speedLabel = SPEED_PRESETS.find((p) => p.value === o.speed)?.hint ?? `${o.speed}×`;

  return (
    <div className="flex flex-col gap-6">
      <Group icon={Play} title="How many times">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Iterations" hint={ds && o.datasetMode === 'sequential' ? `Uses one dataset row per iteration (${ds.rowCount} rows${o.iterations > ds.rowCount ? ', then starts over' : ''}).` : 'Each iteration starts with a fresh browser session.'}>
            <div className="flex items-center gap-2">
              <NumberInput value={o.iterations} min={1} max={100000} onChange={(n) => onChange({ iterations: Math.round(n) })} className="w-32" ariaLabel="Iterations" />
              <div className="flex gap-1">
                {[1, 5, 10, 50, 100].map((n) => (
                  <button key={n} type="button" onClick={() => onChange({ iterations: n })} className={cn('tnum h-7 min-w-8 rounded-md px-1.5 text-[12px] font-medium', o.iterations === n ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-raised hover:text-ink')}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Field>
          <div className="flex gap-4">
            <Field label="Run in parallel" hint={o.headless ? 'Up to 16 browsers.' : 'Up to 6 windows.'}>
              <NumberInput value={o.concurrency} min={1} max={o.headless ? 16 : 6} onChange={(n) => onChange({ concurrency: Math.round(n) })} className="w-28" ariaLabel="Parallel browsers" />
            </Field>
            {!compact && (
              <Field label="Pause between">
                <NumberInput value={o.delayBetweenIterations / 1000} min={0} max={3600} step={1} suffix="s" onChange={(n) => onChange({ delayBetweenIterations: Math.round(n * 1000) })} className="w-28" ariaLabel="Pause between iterations in seconds" />
              </Field>
            )}
          </div>
        </div>
      </Group>

      <Group icon={Gauge} title="Speed">
        <Segmented
          value={o.speed}
          onChange={(v) => onChange({ speed: v })}
          options={SPEED_PRESETS.map((p) => ({ value: p.value, label: p.label, title: p.hint }))}
          ariaLabel="Playback speed"
          className="w-full"
        />
        <p className="-mt-1 text-[12px] text-ink-3">
          {speedLabel}. {o.speed === 0 ? 'Steps run back to back.' : `About ${Math.round(o.stepDelay / (o.speed || 1))} ms between steps.`}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Switch checked={o.useRecordedTiming} onChange={(b) => onChange({ useRecordedTiming: b })} label="Replay with recorded pauses" />
          <Switch checked={o.typingMode === 'type'} onChange={(b) => onChange({ typingMode: b ? 'type' : 'fill' })} label="Type key by key" />
          <Switch checked={o.humanize} onChange={(b) => onChange({ humanize: b })} label="Vary timing like a person" />
        </div>
      </Group>

      <Group icon={Monitor} title="Browser">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Window">
            <Segmented
              value={o.headless ? 'bg' : 'visible'}
              onChange={(v) => onChange({ headless: v === 'bg', concurrency: v === 'visible' ? Math.min(o.concurrency, 6) : o.concurrency })}
              options={[
                { value: 'visible', label: 'Visible', icon: Eye },
                { value: 'bg', label: 'In background', icon: MonitorPlay },
              ]}
              className="w-full"
            />
          </Field>
          <Field label="Browser">
            <Select
              value={o.browser}
              onChange={(b) => onChange({ browser: b })}
              options={browsers.map((b) => ({ value: b.id, label: b.name, disabled: !b.available, hint: b.available ? undefined : (b.note ?? 'Not installed') }))}
            />
          </Field>
        </div>
      </Group>

      <Group icon={Database} title="Data and login">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Dataset" hint={datasets.length ? 'Steps set to “Dataset” read from this table.' : 'Import a CSV in Test data to drive runs from a table.'}>
            <Select
              value={o.datasetId ?? ''}
              onChange={(id) => onChange({ datasetId: id || undefined })}
              options={[{ value: '', label: 'None' }, ...datasets.map((d) => ({ value: d.id, label: d.name, hint: `${d.rowCount} rows · ${d.columns.length} columns` }))]}
            />
          </Field>
          <Field label="Row order">
            <Segmented
              value={o.datasetMode}
              onChange={(m) => onChange({ datasetMode: m })}
              options={[
                { value: 'sequential', label: 'One per iteration' },
                { value: 'random', label: 'Random' },
              ]}
              className="w-full"
            />
          </Field>
          <Field label="Start logged in" hint={sessions.length ? 'Reuses cookies saved after a recording.' : 'Save a login from the live browser to skip sign-in steps.'}>
            <Select value={o.sessionId ?? ''} onChange={(id) => onChange({ sessionId: id || undefined })} options={[{ value: '', label: 'No saved login', icon: KeyRound }, ...sessions.map((s) => ({ value: s.id, label: s.name, hint: s.origins.slice(0, 2).join(', '), icon: KeyRound }))]} />
          </Field>
          <Field label="Generated data style">
            <Select value={o.dataLocale} onChange={(l) => onChange({ dataLocale: l })} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
          </Field>
        </div>
      </Group>

      <Group icon={ShieldCheck} title="When something goes wrong">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Retries per step">
            <NumberInput value={o.stepRetries} min={0} max={5} onChange={(n) => onChange({ stepRetries: Math.round(n) })} className="w-32" ariaLabel="Retries per step" />
          </Field>
          <Field label="Wait for elements up to">
            <NumberInput value={o.stepTimeout / 1000} min={1} max={300} suffix="s" onChange={(n) => onChange({ stepTimeout: Math.round(n * 1000) })} className="w-32" ariaLabel="Step timeout in seconds" />
          </Field>
          <Field label="Retry failed iterations">
            <NumberInput value={o.iterationRetries} min={0} max={5} onChange={(n) => onChange({ iterationRetries: Math.round(n) })} className="w-32" ariaLabel="Iteration retries" />
          </Field>
          <Field label="Screenshots">
            <Select
              value={o.screenshots}
              onChange={(s) => onChange({ screenshots: s })}
              options={[
                { value: 'failure', label: 'When a step fails' },
                { value: 'end', label: 'At the end of each iteration' },
                { value: 'step', label: 'After every step', hint: 'Uses more disk space' },
                { value: 'none', label: 'Never' },
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Switch checked={o.stopOnFailure} onChange={(b) => onChange({ stopOnFailure: b })} label="Stop on first failure" />
          <Switch checked={o.autoHeal} onChange={(b) => onChange({ autoHeal: b })} label="Find changed elements" />
          <Switch checked={o.saveHealedSelectors} onChange={(b) => onChange({ saveHealedSelectors: b })} label="Update the flow when found" />
        </div>
      </Group>

      <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1.5 self-start text-[12.5px] font-medium text-ink-2 hover:text-ink">
        {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Advanced
      </button>
      {advanced && (
        <div className="-mt-2 flex flex-col gap-4 rounded-xl border border-line bg-raised/40 p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Page size">
              <Select
                value={VIEWPORTS.some((v) => v.value === viewportKey) ? viewportKey : 'window'}
                onChange={(k) => {
                  if (k === 'window') onChange({ viewport: null });
                  else {
                    const [w, h] = k.split('x').map(Number);
                    onChange({ viewport: { width: w, height: h } });
                  }
                }}
                options={VIEWPORTS}
              />
            </Field>
            <Field label="Wait for pages to">
              <Select
                value={o.waitUntil}
                onChange={(w) => onChange({ waitUntil: w })}
                options={[
                  { value: 'load', label: 'Finish loading' },
                  { value: 'domcontentloaded', label: 'Show their content', hint: 'Faster, may start before images load' },
                  { value: 'networkidle', label: 'Stop network activity', hint: 'Slowest, most stable for busy apps' },
                  { value: 'commit', label: 'Start loading' },
                ]}
              />
            </Field>
            <Field label="Base delay between steps">
              <NumberInput value={o.stepDelay} min={0} max={10000} step={50} suffix="ms" onChange={(n) => onChange({ stepDelay: Math.round(n) })} ariaLabel="Base delay between steps" />
            </Field>
            <Field label="Keystroke delay">
              <NumberInput value={o.typingDelay} min={0} max={1000} step={10} suffix="ms" onChange={(n) => onChange({ typingDelay: Math.round(n) })} ariaLabel="Keystroke delay" />
            </Field>
            <Field label="Cookies between iterations">
              <Segmented
                value={o.isolation}
                onChange={(v) => onChange({ isolation: v })}
                options={[
                  { value: 'fresh', label: 'Start clean' },
                  { value: 'reuse', label: 'Keep them' },
                ]}
                className="w-full"
              />
            </Field>
            <Field label="Browser language">
              <Input value={o.browserLocale ?? ''} placeholder="e.g. en-GB" onChange={(e) => onChange({ browserLocale: e.target.value || undefined })} />
            </Field>
            <Field label="Time zone">
              <Input value={o.timezone ?? ''} placeholder="e.g. Europe/Berlin" onChange={(e) => onChange({ timezone: e.target.value || undefined })} />
            </Field>
            <Field label="User agent">
              <Input value={o.userAgent ?? ''} placeholder="Browser default" onChange={(e) => onChange({ userAgent: e.target.value || undefined })} />
            </Field>
          </div>
          <Field label="Skip downloading" hint="Blocking heavy resources makes runs faster.">
            <div className="flex gap-4">
              {(['image', 'font', 'media'] as const).map((r) => (
                <label key={r} className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={o.blockResources.includes(r)}
                    onChange={(e) => onChange({ blockResources: e.target.checked ? [...o.blockResources, r] : o.blockResources.filter((x) => x !== r) })}
                  />
                  {r === 'image' ? 'Images' : r === 'font' ? 'Fonts' : 'Video and audio'}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Proxies" hint="One per line, e.g. http://user:pass@host:8080. Each iteration uses the next one.">
            <div className="flex flex-col gap-2">
              <Segmented
                value={o.proxyMode}
                onChange={(m) => onChange({ proxyMode: m })}
                options={[
                  { value: 'none', label: 'Off' },
                  { value: 'rotate', label: 'Rotate' },
                  { value: 'random', label: 'Random' },
                ]}
                size="sm"
              />
              {o.proxyMode !== 'none' && <Textarea mono rows={3} value={o.proxies.join('\n')} onChange={(e) => onChange({ proxies: e.target.value.split('\n') })} placeholder="http://127.0.0.1:8080" />}
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

export function RunDialog() {
  const flowId = useUi((s) => s.runDialogFlow);
  const close = useUi((s) => s.closeRunDialog);
  const settings = useApp((s) => s.settings);
  const flows = useApp((s) => s.flows);
  const runs = useApp((s) => s.runs);
  const flow = flows.find((f) => f.id === flowId);
  const [opts, setOpts] = useState<RunOptions | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (flow) setOpts(mergeRunOptions(settings.runDefaults, flow.runDefaults));
    else setOpts(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  const estimate = useMemo(() => {
    const last = runs.find((r) => r.flowId === flowId && r.avgDuration);
    if (!last?.avgDuration || !opts) return null;
    const factor = opts.speed === 0 ? 0.7 : 1 / Math.max(0.25, opts.speed);
    return (last.avgDuration * factor * opts.iterations) / Math.max(1, opts.concurrency);
  }, [runs, flowId, opts]);

  const start = async () => {
    if (!flow || !opts) return;
    setBusy(true);
    try {
      if (remember) {
        // An open editor owns the flow; update it there so its autosave keeps the change.
        const editor = useEditor.getState();
        if (editor.flow?.id === flow.id) {
          editor.update((f) => void (f.runDefaults = { ...opts }));
          await editor.flushSave();
        } else {
          const full = await api.flows.get(flow.id);
          if (full) await api.flows.save({ ...full, runDefaults: { ...opts } });
        }
      }
      const id = await api.runs.start(flow.id, opts);
      close();
      navigate(`/runs/${id}`);
    } catch (e) {
      toast.error('The run could not start', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!flow && !!opts}
      onOpenChange={(o) => !o && close()}
      icon={Play}
      width={720}
      title={flow ? `Run “${flow.name}”` : 'Run'}
      description={flow ? `${flow.stepCount} steps${flow.randomFieldCount ? ` · ${flow.randomFieldCount} field${flow.randomFieldCount === 1 ? '' : 's'} with generated data` : ''}` : undefined}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember these settings for this flow
          </label>
          {estimate !== null && <span className="text-[12.5px] text-ink-3">About {formatDuration(estimate)}</span>}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Play}
            loading={busy}
            onClick={start}
            onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && void start()}
          >
            Start {opts && opts.iterations > 1 ? `${opts.iterations} iterations` : 'run'}
          </Button>
        </>
      }
    >
      {opts && <RunOptionsForm value={opts} onChange={(p) => setOpts({ ...opts, ...p })} />}
    </Dialog>
  );
}
