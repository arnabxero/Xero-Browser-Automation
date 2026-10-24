import { History, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration, relativeTime } from '@shared/data/format';
import type { RunStatus } from '@shared/types';
import { ProgressBar } from '@/components/charts';
import { Button, EmptyState, Input, PageHeader, Segmented, confirmDialog } from '@/components/ui';
import { RunStatusBadge } from '@/components/visuals';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { isActiveRun, useApp } from '@/store/app';

type Filter = 'all' | 'active' | 'passed' | 'failed';

export function RunsPage() {
  const runs = useApp((s) => s.runs);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      runs.filter((r) => {
        if (filter === 'active' && !isActiveRun(r)) return false;
        if (filter === 'passed' && r.status !== 'passed') return false;
        if (filter === 'failed' && !(['failed', 'error'] as RunStatus[]).includes(r.status)) return false;
        return !q.trim() || r.flowName.toLowerCase().includes(q.trim().toLowerCase());
      }),
    [runs, filter, q],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Runs"
        description="Every run keeps a report with per-step results, screenshots and the data that was typed."
        actions={
          runs.length > 0 && (
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={async () => {
                if (await confirmDialog({ title: 'Clear run history?', description: 'Reports and screenshots of finished runs are deleted. Running runs are kept.', confirm: 'Clear history', tone: 'danger' })) await api.runs.clear();
              }}
            >
              Clear history
            </Button>
          )
        }
      >
        {runs.length > 0 && (
          <div className="mt-5 flex items-center gap-2">
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by flow" className="w-[280px]" aria-label="Search runs" />
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Running' },
                { value: 'passed', label: 'Passed' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>
        )}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {!runs.length ? (
          <EmptyState icon={History} title="No runs yet">
            Open a flow and press Run to replay it once or many times.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_110px_100px_120px_100px] items-center gap-4 border-b border-line px-4 py-2 text-[11.5px] font-medium text-ink-3">
              <span>Flow</span>
              <span>Iterations</span>
              <span>Duration</span>
              <span>Trigger</span>
              <span>Started</span>
              <span>Status</span>
            </div>
            {list.map((r) => {
              const done = r.totals.passed + r.totals.failed + r.totals.stopped;
              return (
                <button key={r.id} type="button" onClick={() => navigate(`/runs/${r.id}`)} className="grid w-full grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_110px_100px_120px_100px] items-center gap-4 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-raised/50">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.flowName}</span>
                    <span className="block truncate text-[12px] text-ink-3">
                      {r.options.headless ? 'Background' : 'Visible'} · {r.options.speed === 0 ? 'max speed' : `${r.options.speed}×`}
                      {r.options.concurrency > 1 ? ` · ${r.options.concurrency} parallel` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col gap-1.5">
                    <span className="tnum text-[12.5px] text-ink-2">
                      {r.totals.passed} passed{r.totals.failed ? ` · ${r.totals.failed} failed` : ''} <span className="text-ink-3">of {r.totals.total}</span>
                    </span>
                    <ProgressBar done={done} total={r.totals.total} failed={r.totals.failed} />
                  </span>
                  <span className="tnum text-[12.5px] text-ink-2">{formatDuration(r.duration ?? (isActiveRun(r) ? Date.now() - r.startedAt : undefined))}</span>
                  <span className="text-[12.5px] text-ink-3">{r.trigger === 'schedule' ? 'Schedule' : 'Manual'}</span>
                  <span className="text-[12.5px] text-ink-3">{relativeTime(r.startedAt)}</span>
                  <RunStatusBadge status={r.status} />
                </button>
              );
            })}
            {!list.length && <p className="px-4 py-8 text-center text-[13px] text-ink-3">No runs match this filter.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
