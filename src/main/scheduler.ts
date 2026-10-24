import { Cron } from 'croner';
import type { RunOptions, RunStatus, Schedule } from '../shared/types';
import type { Repo } from './repo';

function cronFor(s: Schedule): string | undefined {
  const [h, m] = (s.time ?? '09:00').split(':').map((x) => parseInt(x, 10));
  const hh = Number.isFinite(h) ? h : 9;
  const mm = Number.isFinite(m) ? m : 0;
  switch (s.kind) {
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekly':
      return `${mm} ${hh} * * ${(s.days?.length ? s.days : [1]).join(',')}`;
    case 'cron':
      return s.cron?.trim() || undefined;
    default:
      return undefined;
  }
}

export function validateCron(expr: string): string | null {
  try {
    new Cron(expr, { paused: true }).nextRun();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid expression';
  }
}

export function computeNextRun(s: Schedule, from = Date.now()): number | undefined {
  if (!s.enabled) return undefined;
  if (s.kind === 'interval') {
    const every = Math.max(1, s.everyMinutes ?? 60) * 60_000;
    const base = s.lastRunAt ?? s.createdAt;
    return Math.max(base + every, from);
  }
  if (s.kind === 'once') {
    if (!s.at || (s.lastRunAt && s.lastRunAt >= s.at)) return undefined;
    return s.at;
  }
  const expr = cronFor(s);
  if (!expr) return undefined;
  try {
    const next = new Cron(expr, { paused: true }).nextRun(new Date(from));
    return next ? next.getTime() : undefined;
  } catch {
    return undefined;
  }
}

export function describeSchedule(s: Schedule): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (s.kind) {
    case 'interval': {
      const m = s.everyMinutes ?? 60;
      return m % 60 === 0 ? `Every ${m / 60 === 1 ? 'hour' : `${m / 60} hours`}` : `Every ${m} minute${m === 1 ? '' : 's'}`;
    }
    case 'daily':
      return `Every day at ${s.time ?? '09:00'}`;
    case 'weekly':
      return `${(s.days ?? [1]).map((d) => days[d]).join(', ')} at ${s.time ?? '09:00'}`;
    case 'cron':
      return `Cron ${s.cron ?? ''}`;
    case 'once':
      return s.at ? `Once on ${new Date(s.at).toLocaleString()}` : 'Once';
  }
}

export class Scheduler {
  private timer?: NodeJS.Timeout;

  constructor(
    private repo: Repo,
    private startRun: (flowId: string, options: Partial<RunOptions>, scheduleId: string) => string,
    private isBusy: (scheduleId: string) => boolean,
  ) {}

  start() {
    this.refresh(true);
    this.timer = setInterval(() => this.tick(), 15_000);
    setTimeout(() => this.tick(), 3000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recompute next run times; on startup, skip occurrences missed while the app was closed. */
  refresh(startup = false) {
    const now = Date.now();
    for (const s of this.repo.listSchedules()) {
      let next = s.nextRunAt;
      const stale = !next || startup || !s.enabled;
      if (stale) {
        next = computeNextRun(s, now);
        if (startup && s.kind !== 'interval' && s.kind !== 'once' && s.nextRunAt && s.nextRunAt < now - 60_000) next = computeNextRun(s, now);
      }
      if (next !== s.nextRunAt) this.repo.patchSchedule(s.id, { nextRunAt: next });
    }
  }

  tick() {
    const now = Date.now();
    for (const s of this.repo.listSchedules()) {
      if (!s.enabled || !s.nextRunAt || s.nextRunAt > now) continue;
      if (!this.repo.getFlow(s.flowId)) {
        this.repo.patchSchedule(s.id, { enabled: false, nextRunAt: undefined });
        continue;
      }
      if (this.isBusy(s.id)) {
        this.repo.patchSchedule(s.id, { nextRunAt: computeNextRun({ ...s, lastRunAt: now }, now + 1000) });
        continue;
      }
      this.fire(s);
    }
  }

  fire(s: Schedule): string | null {
    const now = Date.now();
    try {
      const runId = this.startRun(s.flowId, s.options ?? {}, s.id);
      const after = { ...s, lastRunAt: now };
      this.repo.patchSchedule(s.id, {
        lastRunAt: now,
        lastRunId: runId,
        nextRunAt: computeNextRun(after, now + 1000),
        enabled: s.kind === 'once' ? false : s.enabled,
      });
      return runId;
    } catch {
      this.repo.patchSchedule(s.id, { lastRunAt: now, lastStatus: 'error', nextRunAt: computeNextRun({ ...s, lastRunAt: now }, now + 1000) });
      return null;
    }
  }

  /** Manual trigger: does not move the regular schedule. */
  runNow(s: Schedule): string | null {
    const runId = this.startRun(s.flowId, s.options ?? {}, s.id);
    this.repo.patchSchedule(s.id, { lastRunAt: Date.now(), lastRunId: runId });
    return runId;
  }

  onRunFinished(scheduleId: string | undefined, status: RunStatus) {
    if (!scheduleId) return;
    if (this.repo.listSchedules().some((s) => s.id === scheduleId)) this.repo.patchSchedule(scheduleId, { lastStatus: status });
  }
}
