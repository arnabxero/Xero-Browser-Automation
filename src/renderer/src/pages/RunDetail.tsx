import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Camera, CircleAlert, Download, FileJson, FileSpreadsheet, FileText, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, relativeTime } from '@shared/data/format';
import { stepTitle } from '@shared/steps';
import type { IterationResult, LogEntry, Run } from '@shared/types';
import { IterationStrip } from '@/components/charts';
import { Button, Dialog, EmptyState, IconButton, Menu, MenuItem, Segmented, Spinner, Tabs, confirmDialog, cn } from '@/components/ui';
import { RunStatusBadge, STEP_ICONS, StepStatusIcon } from '@/components/visuals';
import { api, errorMessage } from '@/lib/api';
import { back, navigate } from '@/lib/router';
import { applyRunEvent, isActiveRun, onRunEvent, useApp } from '@/store/app';
import { toast } from '@/store/toasts';
import { useUi } from '@/store/ui';

const asset = (runId: string, file?: string) => (file ? `xero-asset://run/${runId}/${encodeURIComponent(file)}` : undefined);

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pass' | 'fail' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <p className={cn('tnum text-[20px] leading-tight font-semibold tracking-[-0.02em]', tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-ink')}>{value}</p>
      <p className="text-[12px] text-ink-3">{label}</p>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function IterationDetail({ run, it, onShot }: { run: Run; it: IterationResult; onShot: (src: string) => void }) {
  const mask = useApp((s) => s.settings.maskSecrets);
  const results = new Map(it.steps.map((s) => [s.index, s]));
  const dataEntries = Object.entries(it.data ?? {});
  const varEntries = Object.entries(it.variables ?? {}).filter(([k]) => !(k in (it.data ?? {})));
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-center gap-3">
        <h3 className="text-[15px] font-semibold text-ink">Iteration {it.index + 1}</h3>
        <RunStatusBadge status={it.status} />
        <span className="tnum text-[12.5px] text-ink-3">
          {formatDuration(it.duration)}
          {it.attempt > 1 ? ` · attempt ${it.attempt}` : ''}
          {it.datasetRow !== undefined ? ` · dataset row ${it.datasetRow + 1}` : ''}
          {it.proxy ? ` · via ${it.proxy}` : ''}
        </span>
      </div>
      {it.error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-fail/40 bg-fail-soft px-3 py-2.5">
          <CircleAlert size={16} className="mt-px shrink-0 text-fail" />
          <p className="selectable text-[12.5px] break-words text-ink">
            {it.failedStep !== undefined && <span className="font-medium">Step {it.failedStep + 1}: </span>}
            {it.error}
          </p>
        </div>
      )}
      <ol className="flex flex-col">
        {run.steps.map((s, i) => {
          const r = results.get(i);
          const Icon = STEP_ICONS[s.type];
          const secret = s.field?.type === 'password' && mask;
          return (
            <li key={s.id} className={cn('flex items-start gap-3 border-b border-line py-2 last:border-b-0', !r && 'opacity-50')}>
              <span className="tnum w-6 shrink-0 pt-0.5 text-right text-[11.5px] text-ink-3">{i + 1}</span>
              <Icon size={15} className="mt-0.5 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{stepTitle(s)}</p>
                {r?.error && <p className="selectable text-[12px] break-words text-fail">{r.error}</p>}
                {!r?.error && (r?.message || r?.value) && (
                  <p className="selectable truncate font-mono text-[11.5px] text-ink-3" title={secret ? undefined : (r.value ?? r.message)}>
                    {r.value ? (secret ? '••••••••' : r.value) : r.message}
                  </p>
                )}
                {r?.healed && <p className="text-[11.5px] text-warn">Found by similarity, new selector {r.healed.kind}: {r.healed.value}</p>}
              </div>
              {r?.screenshot && (
                <button type="button" onClick={() => onShot(asset(run.id, r.screenshot)!)} className="shrink-0 overflow-hidden rounded-md border border-line hover:border-accent" aria-label="Open screenshot">
                  <img src={asset(run.id, r.screenshot)} alt="" className="h-10 w-16 object-cover object-top" />
                </button>
              )}
              <span className="tnum w-14 shrink-0 pt-0.5 text-right text-[11.5px] text-ink-3">{r && r.status !== 'running' ? formatDuration(r.duration) : ''}</span>
              <span className="w-4 shrink-0 pt-0.5">
                <StepStatusIcon status={r?.status} />
              </span>
            </li>
          );
        })}
      </ol>
      {it.screenshot && (
        <button type="button" onClick={() => onShot(asset(run.id, it.screenshot)!)} className="self-start overflow-hidden rounded-lg border border-line hover:border-accent">
          <img src={asset(run.id, it.screenshot)} alt="Final page" className="max-h-56" />
        </button>
      )}
      {(dataEntries.length > 0 || varEntries.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {dataEntries.length > 0 && (
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold text-ink-2">Data entered</h4>
              <dl className="overflow-hidden rounded-lg border border-line">
                {dataEntries.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
                    <dt className="truncate text-[12px] text-ink-3">{k}</dt>
                    <dd className="selectable truncate font-mono text-[11.5px] text-ink">{mask && /pass(word)?|pwd/i.test(k) ? '••••••••' : v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {varEntries.length > 0 && (
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold text-ink-2">Variables</h4>
              <dl className="overflow-hidden rounded-lg border border-line">
                {varEntries.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
                    <dt className="truncate font-mono text-[11.5px] text-accent">{k}</dt>
                    <dd className="selectable truncate font-mono text-[11.5px] text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogView({ logs }: { logs: LogEntry[] }) {
  const [level, setLevel] = useState<'all' | 'problems'>('all');
  const list = useMemo(() => (level === 'all' ? logs.filter((l) => l.level !== 'debug') : logs.filter((l) => l.level === 'warn' || l.level === 'error')), [logs, level]);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => parent.current, estimateSize: () => 26, overscan: 20 });
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && list.length) v.scrollToIndex(list.length - 1, { align: 'end' });
  }, [list.length, follow, v]);
  const tone = { debug: 'text-ink-3', info: 'text-ink-2', success: 'text-pass', warn: 'text-warn', error: 'text-fail' };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-2">
        <Segmented
          size="sm"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'problems', label: 'Warnings and errors' },
          ]}
        />
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" className="accent-[var(--accent)]" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow new lines
        </label>
      </div>
      <div ref={parent} className="selectable min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((row) => {
            const l = list[row.index];
            return (
              <div key={row.key} className="absolute inset-x-0 flex gap-3 px-5 py-1" style={{ transform: `translateY(${row.start}px)` }}>
                <span className="tnum shrink-0 text-ink-3">{new Date(l.t).toLocaleTimeString(undefined, { hour12: false })}</span>
                {l.iteration !== undefined && <span className="tnum w-10 shrink-0 text-ink-3">#{l.iteration + 1}</span>}
                <span className={cn('min-w-0 break-words', tone[l.level])}>{l.msg}</span>
              </div>
            );
          })}
        </div>
        {!list.length && <p className="px-5 py-6 font-sans text-[12.5px] text-ink-3">No log lines yet.</p>}
      </div>
    </div>
  );
}

function DataTable({ run }: { run: Run }) {
  const cols = useMemo(() => [...new Set(run.iterations.flatMap((i) => Object.keys(i.data ?? {})))], [run.iterations]);
  const mask = useApp((s) => s.settings.maskSecrets);
  if (!cols.length) return <EmptyState icon={FileSpreadsheet} title="No form data in this run">Steps that type, choose or tick something list their values here.</EmptyState>;
  return (
    <div className="h-full overflow-auto">
      <table className="selectable w-max min-w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-[1] bg-panel">
          <tr>
            <th className="border-b border-line px-3 py-2 text-left font-medium text-ink-3">#</th>
            <th className="border-b border-line px-3 py-2 text-left font-medium text-ink-3">Status</th>
            {cols.map((c) => (
              <th key={c} className="border-b border-line px-3 py-2 text-left font-medium whitespace-nowrap text-ink-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.iterations.slice(0, 2000).map((it) => (
            <tr key={it.index} className="hover:bg-raised/50">
              <td className="tnum border-b border-line px-3 py-1.5 text-ink-3">{it.index + 1}</td>
              <td className="border-b border-line px-3 py-1.5">
                <RunStatusBadge status={it.status} />
              </td>
              {cols.map((c) => (
                <td key={c} className="max-w-[260px] truncate border-b border-line px-3 py-1.5 font-mono text-[11.5px] text-ink">
                  {mask && /pass(word)?|pwd/i.test(c) && it.data?.[c] ? '••••••••' : (it.data?.[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveView({ run, iteration }: { run: Run; iteration?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const img = await api.runs.peek(run.id, iteration).catch(() => null);
      if (!stop && img) setSrc(img);
      if (!stop) setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [run.id, iteration]);
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      {src ? <img src={src} alt="Current page of the running iteration" className="max-h-full max-w-full rounded-lg border border-line shadow-pop" /> : <Spinner size={22} />}
      <p className="mt-3 text-[12px] text-ink-3">Refreshes about once a second{iteration !== undefined ? ` · iteration ${iteration + 1}` : ''}</p>
    </div>
  );
}

export function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<'iterations' | 'live' | 'log' | 'data' | 'settings'>('iterations');
  const [filter, setFilter] = useState<'all' | 'failed' | 'passed'>('all');
  const [shot, setShot] = useState<string | null>(null);
  const openRun = useUi((s) => s.openRunDialog);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    let alive = true;
    void api.runs.get(id).then((r) => {
      if (!alive) return;
      runRef.current = r;
      setRun(r);
    });
    const off = onRunEvent((e) => {
      if (!runRef.current) return;
      const next = applyRunEvent(runRef.current, e);
      if (next !== runRef.current) {
        runRef.current = next;
        setRun(next);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [id]);

  const active = !!run && isActiveRun(run);
  const now = useNow(active);
  const iterations = useMemo(() => {
    if (!run) return [];
    if (filter === 'failed') return run.iterations.filter((i) => i.status === 'failed');
    if (filter === 'passed') return run.iterations.filter((i) => i.status === 'passed');
    return run.iterations;
  }, [run, filter]);

  useEffect(() => {
    if (!run || selected !== undefined) return;
    const pick = run.iterations.find((i) => i.status === 'running') ?? run.iterations.find((i) => i.status === 'failed') ?? run.iterations[0];
    if (pick) setSelected(pick.index);
  }, [run, selected]);

  const listRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: iterations.length, getScrollElement: () => listRef.current, estimateSize: () => 44, overscan: 12 });

  if (run === undefined)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  if (run === null)
    return (
      <EmptyState icon={CircleAlert} title="This run no longer exists" action={<Button onClick={() => navigate('/runs')}>Back to runs</Button>}>
        It may have been removed when old runs were cleaned up.
      </EmptyState>
    );

  const t = run.totals;
  const done = t.passed + t.failed + t.stopped;
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const finished = run.iterations.filter((i) => i.duration !== undefined && (i.status === 'passed' || i.status === 'failed'));
  const avg = finished.length ? finished.reduce((a, i) => a + (i.duration ?? 0), 0) / finished.length : undefined;
  const perMin = elapsed > 5000 && done ? (done / elapsed) * 60000 : undefined;
  const eta = active && perMin && t.total > done ? ((t.total - done) / perMin) * 60000 : undefined;
  const sel = selected !== undefined ? run.iterations[selected] : undefined;

  const exportAs = async (format: 'html' | 'csv' | 'json') => {
    try {
      const r = await api.runs.exportReport(run.id, format);
      if (r.path) toast.success('Exported', r.path, { label: 'Open', run: () => void api.app.openPath(r.path!) });
    } catch (e) {
      toast.error('Export failed', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => back('/runs')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(`/flows/${run.flowId}`)} className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink hover:underline">
              {run.flowName}
            </button>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="text-[12px] text-ink-3">
            {run.trigger === 'schedule' ? 'Scheduled run' : 'Manual run'} · started {relativeTime(run.startedAt)} · {run.options.headless ? 'background browser' : 'visible browser'} · speed {run.options.speed === 0 ? 'max' : `${run.options.speed}×`}
          </p>
        </div>
        {active ? (
          <>
            {run.status === 'paused' ? (
              <Button icon={Play} onClick={() => void api.runs.resume(run.id)}>
                Resume
              </Button>
            ) : (
              <Button icon={Pause} onClick={() => void api.runs.pause(run.id)}>
                Pause
              </Button>
            )}
            <Button variant="danger" icon={Square} onClick={() => void api.runs.stop(run.id)}>
              Stop
            </Button>
          </>
        ) : (
          <>
            <Button icon={RotateCcw} onClick={() => openRun(run.flowId)}>
              Run again
            </Button>
            <Menu
              trigger={
                <Button variant="secondary" icon={Download}>
                  Export
                </Button>
              }
            >
              <MenuItem icon={FileText} onSelect={() => void exportAs('html')} hint="One file with results and failure screenshots">
                Report (HTML)
              </MenuItem>
              <MenuItem icon={FileSpreadsheet} onSelect={() => void exportAs('csv')} hint="One row per iteration with every typed value">
                Data used (CSV)
              </MenuItem>
              <MenuItem icon={FileJson} onSelect={() => void exportAs('json')}>
                Everything (JSON)
              </MenuItem>
            </Menu>
            <IconButton
              icon={Trash2}
              label="Delete run"
              tone="danger"
              onClick={async () => {
                if (await confirmDialog({ title: 'Delete this run?', description: 'Its report and screenshots are removed.', confirm: 'Delete run', tone: 'danger' })) {
                  await api.runs.delete(run.id);
                  navigate('/runs');
                }
              }}
            />
          </>
        )}
      </header>

      <div className="flex shrink-0 flex-col gap-4 border-b border-line px-5 py-4">
        <div className="grid grid-cols-6 gap-3">
          <Kpi label={active ? `Done of ${t.total}` : 'Iterations'} value={active ? `${done}` : `${t.total}`} />
          <Kpi label="Passed" value={String(t.passed)} tone={t.passed ? 'pass' : undefined} />
          <Kpi label="Failed" value={String(t.failed)} tone={t.failed ? 'fail' : undefined} />
          <Kpi label="Average iteration" value={formatDuration(avg)} />
          <Kpi label={active ? 'Elapsed' : 'Total time'} value={formatDuration(elapsed)} />
          <Kpi label={eta ? 'Time left' : 'Per minute'} value={eta ? formatDuration(eta) : perMin ? perMin.toFixed(perMin < 10 ? 1 : 0) : '—'} />
        </div>
        <div className="flex items-center gap-4">
          <IterationStrip iterations={run.iterations} selected={selected} onSelect={(i) => { setSelected(i); setTab('iterations'); }} className="flex-1" />
          <div className="flex shrink-0 items-center gap-3 text-[11.5px] text-ink-3">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-pass" /> Passed</span>
            <span className="flex items-center gap-1"><span className="hatch-fail h-2.5 w-2.5 rounded-sm" /> Failed</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Running</span>
          </div>
        </div>
        {run.error && <p className="selectable rounded-lg border border-fail/40 bg-fail-soft px-3 py-2 text-[12.5px] text-ink">{run.error}</p>}
      </div>

      <div className="flex shrink-0 items-center border-b border-line px-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'iterations', label: 'Iterations', count: run.iterations.length },
            ...(active ? [{ value: 'live' as const, label: 'Live view' }] : []),
            { value: 'log', label: 'Log' },
            { value: 'data', label: 'Data used' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'iterations' && (
          <div className="flex h-full">
            <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
              <div className="border-b border-line px-3 py-2">
                <Segmented
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  className="w-full"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'failed', label: `Failed ${t.failed}` },
                    { value: 'passed', label: `Passed ${t.passed}` },
                  ]}
                />
              </div>
              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Iterations">
                <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
                  {virt.getVirtualItems().map((row) => {
                    const it = iterations[row.index];
                    return (
                      <button
                        key={row.key}
                        type="button"
                        role="option"
                        aria-selected={selected === it.index}
                        onClick={() => setSelected(it.index)}
                        style={{ transform: `translateY(${row.start}px)`, height: row.size }}
                        className={cn('absolute inset-x-0 flex items-center gap-2.5 border-b border-line px-3 text-left', selected === it.index ? 'bg-accent-soft' : 'hover:bg-raised/50')}
                      >
                        <span className="tnum w-10 text-[12.5px] font-medium text-ink">#{it.index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{it.error ?? (it.status === 'running' ? `Step ${(it.steps.at(-1)?.index ?? 0) + 1}…` : formatDuration(it.duration))}</span>
                        <RunStatusBadge status={it.status} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">{sel ? <IterationDetail run={run} it={sel} onShot={setShot} /> : <EmptyState icon={Camera} title="Pick an iteration">Its steps, values and screenshots appear here.</EmptyState>}</div>
          </div>
        )}
        {tab === 'live' && active && <LiveView run={run} iteration={sel?.status === 'running' ? sel.index : undefined} />}
        {tab === 'log' && <LogView logs={run.logs} />}
        {tab === 'data' && <DataTable run={run} />}
        {tab === 'settings' && (
          <div className="h-full overflow-y-auto px-8 py-6">
            <dl className="grid max-w-[720px] grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
              {(
                [
                  ['Iterations', run.options.iterations],
                  ['In parallel', run.options.concurrency],
                  ['Speed', run.options.speed === 0 ? 'Max' : `${run.options.speed}×`],
                  ['Typing', run.options.typingMode === 'type' ? 'Key by key' : 'Instant'],
                  ['Browser', `${run.options.browser}${run.options.headless ? ', background' : ', visible'}`],
                  ['Step timeout', `${run.options.stepTimeout / 1000} s`],
                  ['Retries per step', run.options.stepRetries],
                  ['Retry failed iterations', run.options.iterationRetries],
                  ['Stop on first failure', run.options.stopOnFailure ? 'Yes' : 'No'],
                  ['Screenshots', run.options.screenshots],
                  ['Generated data style', run.options.dataLocale],
                  ['Cookies between iterations', run.options.isolation === 'fresh' ? 'Start clean' : 'Kept'],
                  ['Find changed elements', run.options.autoHeal ? 'On' : 'Off'],
                  ['Selectors healed', run.healedCount ?? 0],
                ] as [string, string | number][]
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-line pb-2">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="tnum text-ink">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <Dialog open={!!shot} onOpenChange={(o) => !o && setShot(null)} title="Screenshot" width={1200}>
        {shot && <img src={shot} alt="Step screenshot" className="selectable w-full rounded-lg border border-line" />}
      </Dialog>
    </div>
  );
}
