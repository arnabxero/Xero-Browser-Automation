import { useEffect, useMemo, useRef, useState } from 'react';
import type { IterationResult, RunSummary } from '@shared/types';
import { cn } from './ui';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface DayBucket {
  day: Date;
  passed: number;
  failed: number;
  runs: number;
}

export function activityBuckets(runs: RunSummary[], days = 14): DayBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: DayBucket[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    return { day: d, passed: 0, failed: 0, runs: 0 };
  });
  const start = buckets[0].day.getTime();
  for (const r of runs) {
    if (r.startedAt < start) continue;
    const idx = Math.floor((r.startedAt - start) / 86_400_000);
    const b = buckets[Math.min(days - 1, Math.max(0, idx))];
    b.passed += r.totals.passed;
    b.failed += r.totals.failed;
    b.runs++;
  }
  return buckets;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Rounded-top bar segment path anchored at the bottom. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function ActivityChart({ runs, height = 150 }: { runs: RunSummary[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => activityBuckets(runs), [runs]);
  const max = niceMax(Math.max(1, ...data.map((d) => d.passed + d.failed)));
  const padL = 30;
  const padB = 22;
  const padT = 8;
  const plotW = Math.max(0, width - padL - 4);
  const plotH = height - padB - padT;
  const slot = plotW / data.length;
  const barW = Math.max(4, Math.min(22, slot * 0.6));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const total = data.reduce((a, d) => a + d.passed + d.failed, 0);
  const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-pass" /> Passed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hatch-fail h-2.5 w-2.5 rounded-sm" /> Failed
        </span>
        <span className="ml-auto text-ink-3">Iterations per day, last 14 days</span>
      </div>
      <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Iterations per day over the last 14 days, ${total} in total`}>
            <defs>
              <pattern id="fail-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
                <rect width="5" height="5" fill="var(--fail)" />
                <rect width="2" height="5" fill="rgb(0 0 0 / 0.28)" />
              </pattern>
            </defs>
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line x1={padL} x2={width} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '2 4'} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" className="tnum">
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + slot * i + slot / 2;
              const x = cx - barW / 2;
              const passH = (d.passed / max) * plotH;
              const failH = (d.failed / max) * plotH;
              const gap = d.passed && d.failed ? 2 : 0;
              const dim = hover !== null && hover !== i;
              return (
                <g key={i} opacity={dim ? 0.45 : 1}>
                  {d.passed > 0 && (d.failed > 0 ? <rect x={x} y={y(d.passed)} width={barW} height={passH} fill="var(--pass)" /> : <path d={barPath(x, y(d.passed), barW, passH, 4)} fill="var(--pass)" />)}
                  {d.failed > 0 && <path d={barPath(x, y(d.passed) - failH - gap, barW, failH, 4)} fill="url(#fail-hatch)" />}
                  {(i % 2 === (data.length - 1) % 2 || data.length <= 7) && (
                    <text x={cx} y={height - 6} textAnchor="middle" fontSize="10.5" fill={i === data.length - 1 ? 'var(--ink-2)' : 'var(--ink-3)'}>
                      {i === data.length - 1 ? 'Today' : d.day.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}
                    </text>
                  )}
                  <rect x={padL + slot * i} y={padT} width={slot} height={plotH + 4} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px] shadow-pop"
            style={{ left: Math.min(width - 150, Math.max(0, padL + slot * hover + slot / 2 - 70)), top: 0 }}
          >
            <p className="font-medium text-ink">{fmtDay(data[hover].day)}</p>
            <p className="tnum flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-sm bg-pass" /> {data[hover].passed} passed
            </p>
            <p className="tnum flex items-center gap-1.5 text-ink-2">
              <span className="hatch-fail h-2 w-2 rounded-sm" /> {data[hover].failed} failed
            </p>
            <p className="tnum text-ink-3">
              {data[hover].runs} run{data[hover].runs === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const CELL: Record<IterationResult['status'], string> = {
  passed: 'bg-pass',
  failed: 'hatch-fail',
  stopped: 'hatch-warn',
  running: 'bg-accent rec-pulse',
  pending: 'bg-line-strong/60',
};

export function IterationStrip({
  iterations,
  selected,
  onSelect,
  className,
}: {
  iterations: Pick<IterationResult, 'index' | 'status'>[];
  selected?: number;
  onSelect?: (i: number) => void;
  className?: string;
}) {
  if (iterations.length > 600) {
    const t = { passed: 0, failed: 0, stopped: 0, running: 0, pending: 0 };
    for (const it of iterations) t[it.status]++;
    const total = iterations.length;
    return (
      <div className={cn('flex h-4 w-full gap-[2px] overflow-hidden rounded-[3px]', className)} role="img" aria-label={`${t.passed} passed, ${t.failed} failed, ${t.running} running, ${t.pending} waiting`}>
        {(['passed', 'failed', 'stopped', 'running', 'pending'] as const).map((k) =>
          t[k] ? <div key={k} className={CELL[k].replace('rec-pulse', '')} style={{ width: `${(t[k] / total) * 100}%` }} title={`${t[k]} ${k}`} /> : null,
        )}
      </div>
    );
  }
  const big = iterations.length <= 60;
  return (
    <div className={cn('flex flex-wrap gap-[3px]', className)} role="list" aria-label="Iterations">
      {iterations.map((it) => (
        <button
          key={it.index}
          type="button"
          role="listitem"
          onClick={() => onSelect?.(it.index)}
          title={`Iteration ${it.index + 1}: ${it.status}`}
          aria-label={`Iteration ${it.index + 1}: ${it.status}`}
          className={cn('rounded-[3px] transition-transform hover:scale-110', big ? 'h-6 w-3' : 'h-4 w-2', CELL[it.status], selected === it.index && 'ring-2 ring-ink ring-offset-1 ring-offset-panel')}
        />
      ))}
    </div>
  );
}

export function ProgressBar({ done, total, failed = 0, className }: { done: number; total: number; failed?: number; className?: string }) {
  const pass = total ? ((done - failed) / total) * 100 : 0;
  const fail = total ? (failed / total) * 100 : 0;
  return (
    <div className={cn('flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-line', className)} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      {pass > 0 && <div className="h-full rounded-full bg-pass" style={{ width: `${pass}%` }} />}
      {fail > 0 && <div className="hatch-fail h-full rounded-full" style={{ width: `${fail}%` }} />}
    </div>
  );
}
