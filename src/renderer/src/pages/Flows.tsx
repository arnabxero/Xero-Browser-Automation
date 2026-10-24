import { Copy, Download, Ellipsis, FileCode, FileDown, Pencil, Play, Search, Star, Trash2, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import { relativeTime } from '@shared/data/format';
import type { FlowSummary } from '@shared/types';
import { Button, EmptyState, IconButton, Input, Menu, MenuItem, MenuSeparator, PageHeader, Select, confirmDialog, cn } from '@/components/ui';
import { RunStatusBadge } from '@/components/visuals';
import { api, errorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { toast } from '@/store/toasts';
import { useUi } from '@/store/ui';
import { FlowGlyph } from './Dashboard';

type Sort = 'edited' | 'name' | 'run' | 'created';

export async function exportFlow(id: string, format: 'json' | 'playwright') {
  try {
    const r = await api.flows.exportFile(id, format);
    if (r.path) toast.success(format === 'playwright' ? 'Exported Playwright test' : 'Exported flow', r.path, { label: 'Show in folder', run: () => void api.app.showInFolder(r.path!) });
  } catch (e) {
    toast.error('Export failed', errorMessage(e));
  }
}

export async function deleteFlow(f: Pick<FlowSummary, 'id' | 'name'>) {
  const ok = await confirmDialog({ title: `Delete “${f.name}”?`, description: 'The flow and its schedules are removed. Past run reports stay in Run history.', confirm: 'Delete flow', tone: 'danger' });
  if (!ok) return false;
  await api.flows.delete(f.id);
  toast.info('Flow deleted');
  return true;
}

export async function importFlows() {
  try {
    const list = await api.flows.importFiles();
    if (list.length) toast.success(`Imported ${list.length} flow${list.length === 1 ? '' : 's'}`, undefined, list.length === 1 ? { label: 'Open', run: () => navigate(`/flows/${list[0].id}`) } : undefined);
  } catch (e) {
    toast.error('Import failed', errorMessage(e));
  }
}

export function FlowsPage() {
  const flows = useApp((s) => s.flows);
  const openRun = useUi((s) => s.openRunDialog);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('edited');
  const [tag, setTag] = useState<string | null>(null);

  const tags = useMemo(() => [...new Set(flows.flatMap((f) => f.tags))].sort(), [flows]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = flows.filter((f) => (!tag || f.tags.includes(tag)) && (!needle || `${f.name} ${f.domain ?? ''} ${f.description ?? ''} ${f.tags.join(' ')}`.toLowerCase().includes(needle)));
    out = out.slice().sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'run':
          return (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0);
        case 'created':
          return b.createdAt - a.createdAt;
        default:
          return b.updatedAt - a.updatedAt;
      }
    });
    return out;
  }, [flows, q, sort, tag]);

  const toggleFavorite = async (f: FlowSummary) => {
    const full = await api.flows.get(f.id);
    if (full) await api.flows.save({ ...full, favorite: !full.favorite });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Flows"
        description="Recorded browser sessions you can edit, run and schedule."
        actions={
          <>
            <Button icon={FileDown} onClick={() => void importFlows()}>
              Import
            </Button>
            <Button variant="rec" onClick={() => navigate('/record')}>
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
              New recording
            </Button>
          </>
        }
      >
        {flows.length > 0 && (
          <div className="mt-5 flex items-center gap-2">
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, site or tag" className="w-[320px]" aria-label="Search flows" />
            <div className="w-[190px]">
              <Select
                value={sort}
                onChange={setSort}
                ariaLabel="Sort"
                options={[
                  { value: 'edited', label: 'Recently edited' },
                  { value: 'run', label: 'Recently run' },
                  { value: 'created', label: 'Newest first' },
                  { value: 'name', label: 'Name' },
                ]}
              />
            </div>
            {tags.length > 0 && (
              <div className="ml-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} className={cn('h-6 rounded-md border px-2 text-[12px]', tag === t ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-ink-2 hover:text-ink')}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {!flows.length ? (
          <EmptyState
            icon={Workflow}
            title="No flows yet"
            action={
              <>
                <Button variant="rec" onClick={() => navigate('/record')}>
                  <span className="h-2.5 w-2.5 rounded-full bg-white" />
                  Record a flow
                </Button>
                <Button icon={FileDown} onClick={() => void importFlows()}>
                  Import a file
                </Button>
              </>
            }
          >
            Record yourself using a website and the steps appear here, ready to replay.
          </EmptyState>
        ) : !list.length ? (
          <EmptyState icon={Search} title="No flows match">
            Try a different search or clear the tag filter.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="grid grid-cols-[minmax(0,2.4fr)_90px_120px_minmax(0,1.2fr)_70px_112px] items-center gap-4 border-b border-line px-4 py-2 text-[11.5px] font-medium text-ink-3">
              <span>Flow</span>
              <span>Steps</span>
              <span>Generated data</span>
              <span>Last run</span>
              <span>Runs</span>
              <span />
            </div>
            {list.map((f) => (
              <div key={f.id} className="group grid grid-cols-[minmax(0,2.4fr)_90px_120px_minmax(0,1.2fr)_70px_112px] items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-raised/50">
                <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate(`/flows/${f.id}`)}>
                  <FlowGlyph name={f.name} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-medium text-ink">{f.name}</span>
                      {f.favorite && <Star size={13} className="shrink-0 fill-warn text-warn" />}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-[12px] text-ink-3">
                      {f.domain ?? 'No start page'} · edited {relativeTime(f.updatedAt)}
                      {f.tags.map((t) => (
                        <span key={t} className="rounded bg-raised px-1 text-[11px] text-ink-2">
                          {t}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                <span className="tnum text-[13px] text-ink-2">{f.stepCount}</span>
                <span className="tnum text-[13px] text-ink-2">{f.fieldCount ? `${f.randomFieldCount} of ${f.fieldCount} fields` : '—'}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {f.lastRun ? (
                    <>
                      <RunStatusBadge status={f.lastRun.status} />
                      <button type="button" onClick={() => navigate(`/runs/${f.lastRun!.runId}`)} className="truncate text-[12.5px] text-ink-3 hover:text-ink hover:underline">
                        {f.lastRun.passed}/{f.lastRun.total} · {relativeTime(f.lastRun.at)}
                      </button>
                    </>
                  ) : (
                    <span className="text-[12.5px] text-ink-3">Not run yet</span>
                  )}
                </span>
                <span className="tnum text-[13px] text-ink-2">{f.runCount ?? 0}</span>
                <span className="flex items-center justify-end gap-0.5">
                  <IconButton icon={Play} label="Run" tone="accent" onClick={() => openRun(f.id)} />
                  <IconButton icon={Pencil} label="Edit" onClick={() => navigate(`/flows/${f.id}`)} />
                  <Menu trigger={<IconButton icon={Ellipsis} label="More" />}>
                    <MenuItem icon={Star} onSelect={() => void toggleFavorite(f)}>
                      {f.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    </MenuItem>
                    <MenuItem
                      icon={Copy}
                      onSelect={async () => {
                        const copy = await api.flows.duplicate(f.id);
                        if (copy) toast.success('Flow duplicated', copy.name, { label: 'Open', run: () => navigate(`/flows/${copy.id}`) });
                      }}
                    >
                      Duplicate
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={Download} onSelect={() => void exportFlow(f.id, 'json')} hint="Share with another Xero install">
                      Export flow file
                    </MenuItem>
                    <MenuItem icon={FileCode} onSelect={() => void exportFlow(f.id, 'playwright')} hint="TypeScript test for @playwright/test">
                      Export as Playwright test
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={Trash2} tone="danger" onSelect={() => void deleteFlow(f)}>
                      Delete
                    </MenuItem>
                  </Menu>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
