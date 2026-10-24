import { CalendarClock, ChevronRight, Play, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { formatDuration, relativeTime } from '@shared/data/format';
import { ActivityChart, ProgressBar } from '@/components/charts';
import { RecordBar } from '@/components/RecordBar';
import { Button, IconButton, Section } from '@/components/ui';
import { RunStatusBadge } from '@/components/visuals';
import { navigate } from '@/lib/router';
import { isActiveRun, useApp } from '@/store/app';
import { useUi } from '@/store/ui';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="tnum text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{value}</p>
      <p className="text-[12px] text-ink-3">{label}</p>
      {sub && <p className="text-[11.5px] text-ink-3">{sub}</p>}
    </div>
  );
}

export function FlowGlyph({ name, className = 'h-8 w-8 text-[12px]' }: { name: string; className?: string }) {
  const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg font-semibold ${className}`}
      style={{ background: `oklch(0.62 0.12 ${hue} / 0.18)`, color: `oklch(0.6 0.14 ${hue})` }}
    >
      {name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '·'}
    </span>
  );
}

export function Dashboard() {
  const flows = useApp((s) => s.flows);
  const runs = useApp((s) => s.runs);
  const schedules = useApp((s) => s.schedules);
  const openRun = useUi((s) => s.openRunDialog);
  const active = runs.filter(isActiveRun);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const week = runs.filter((r) => r.startedAt >= weekAgo);
    const passed = week.reduce((a, r) => a + r.totals.passed, 0);
    const failed = week.reduce((a, r) => a + r.totals.failed, 0);
    return { runs: week.length, iterations: passed + failed, rate: passed + failed ? Math.round((passed / (passed + failed)) * 100) : null };
  }, [runs]);

  const upcoming = schedules
    .filter((s) => s.enabled && s.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 4);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-8 pt-10 pb-12">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em] text-ink">What should the browser do for you?</h1>
          <p className="mt-1.5 max-w-[64ch] text-[13.5px] text-ink-2">Open a site and use it as you normally would. Every click and keystroke becomes a step you can replay with fresh data, as many times as you need.</p>
          <div className="mt-5">
            <RecordBar autoFocus={!flows.length} />
          </div>
        </div>

        {!flows.length ? (
          <ol className="grid grid-cols-3 gap-4">
            {[
              ['Record', 'Browse normally. Xero writes down each action, the elements you used and what you typed.'],
              ['Refine', 'Swap typed values for realistic generated data, add checks, and reorder or edit steps.'],
              ['Run', 'Replay once or ten thousand times, several browsers at a time, at the speed you choose or on a schedule.'],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-line bg-panel p-5">
                <span className="tnum flex h-6 w-6 items-center justify-center rounded-md bg-raised text-[12px] font-semibold text-ink-2">{i + 1}</span>
                <h3 className="mt-3 text-[14px] font-semibold text-ink">{t}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{d}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-5">
            <Section
              title="Recent flows"
              actions={
                <Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => navigate('/flows')}>
                  All flows
                </Button>
              }
            >
              <ul>
                {flows.slice(0, 7).map((f) => (
                  <li key={f.id} className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-raised/50">
                    <FlowGlyph name={f.name} />
                    <button type="button" onClick={() => navigate(`/flows/${f.id}`)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[13px] font-medium text-ink">{f.name}</p>
                      <p className="truncate text-[12px] text-ink-3">
                        {f.domain ?? 'No start page'} · {f.stepCount} steps{f.randomFieldCount ? ` · ${f.randomFieldCount} generated` : ''}
                      </p>
                    </button>
                    {f.lastRun ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[12px] text-ink-3">{relativeTime(f.lastRun.at)}</span>
                        <RunStatusBadge status={f.lastRun.status} />
                      </div>
                    ) : (
                      <span className="shrink-0 text-[12px] text-ink-3">Not run yet</span>
                    )}
                    <IconButton icon={Play} label="Run" tone="accent" onClick={() => openRun(f.id)} />
                  </li>
                ))}
              </ul>
            </Section>

            <div className="flex flex-col gap-5">
              <Section title="Activity">
                <div className="flex flex-col gap-4 p-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Runs this week" value={String(stats.runs)} />
                    <Stat label="Iterations" value={stats.iterations.toLocaleString()} />
                    <Stat label="Passed" value={stats.rate === null ? '—' : `${stats.rate}%`} />
                  </div>
                  <ActivityChart runs={runs} />
                </div>
              </Section>

              {active.length > 0 && (
                <Section title="Running now">
                  <ul>
                    {active.map((r) => {
                      const done = r.totals.passed + r.totals.failed + r.totals.stopped;
                      return (
                        <li key={r.id}>
                          <button type="button" onClick={() => navigate(`/runs/${r.id}`)} className="flex w-full flex-col gap-2 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-raised/50">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{r.flowName}</span>
                              <span className="tnum text-[12px] text-ink-3">
                                {done} / {r.totals.total}
                              </span>
                              <RunStatusBadge status={r.status} />
                            </div>
                            <ProgressBar done={done} total={r.totals.total} failed={r.totals.failed} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              <Section
                title="Coming up"
                actions={
                  <Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => navigate('/schedules')}>
                    Schedules
                  </Button>
                }
              >
                {upcoming.length ? (
                  <ul>
                    {upcoming.map((s) => {
                      const flow = flows.find((f) => f.id === s.flowId);
                      return (
                        <li key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                          <CalendarClock size={15} className="text-ink-3" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name || flow?.name || 'Flow'}</span>
                          <span className="text-[12px] text-ink-3">{relativeTime(s.nextRunAt)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-[12.5px] text-ink-3">Nothing scheduled. Schedules run flows by themselves, even while the window is closed.</p>
                )}
              </Section>
            </div>
          </div>
        )}

        {flows.length > 0 && runs.length > 0 && (
          <Section
            title="Latest runs"
            actions={
              <Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => navigate('/runs')}>
                Run history
              </Button>
            }
          >
            <ul>
              {runs.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => navigate(`/runs/${r.id}`)} className="grid w-full grid-cols-[minmax(0,1fr)_120px_110px_110px_90px] items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-raised/50">
                    <span className="flex min-w-0 items-center gap-2">
                      <Workflow size={14} className="shrink-0 text-ink-3" />
                      <span className="truncate text-[13px] text-ink">{r.flowName}</span>
                    </span>
                    <span className="tnum text-[12.5px] text-ink-2">
                      {r.totals.passed} / {r.totals.total} passed
                    </span>
                    <span className="tnum text-[12.5px] text-ink-3">{formatDuration(r.duration)}</span>
                    <span className="text-[12.5px] text-ink-3">{relativeTime(r.startedAt)}</span>
                    <RunStatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
