import { Database, Download, FileUp, Plus, RefreshCw, Save, Search, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, DATA_TYPES, createGeneratorScope, generateValue, getDataType, sampleValues } from '@shared/data/catalog';
import { relativeTime } from '@shared/data/format';
import { LOCALES } from '@shared/data/locales';
import { uid } from '@shared/defaults';
import type { Dataset } from '@shared/types';
import { DataTypePicker } from '@/components/DataTypePicker';
import { DataOptionsForm } from '@/components/ValueEditor';
import { Button, EmptyState, Field, IconButton, Input, NumberInput, PageHeader, Popover, Select, Tabs, confirmDialog, cn } from '@/components/ui';
import { CATEGORY_ICONS } from '@/components/visuals';
import { api, errorMessage } from '@/lib/api';
import { useRoute } from '@/lib/router';
import { useApp } from '@/store/app';
import { toast } from '@/store/toasts';

// ── Datasets ───────────────────────────────────────────────────────────────

function DatasetEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    void api.datasets.get(id).then(setDs);
    setDirty(false);
  }, [id]);
  useEffect(() => {
    if (!dirty || !ds) return;
    const t = setTimeout(() => {
      void api.datasets.save(ds);
      setDirty(false);
    }, 600);
    return () => clearTimeout(t);
  }, [ds, dirty]);
  if (!ds) return null;
  const edit = (fn: (d: Dataset) => Dataset) => {
    setDs((d) => (d ? fn(d) : d));
    setDirty(true);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <input value={ds.name} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-[15px] font-semibold text-ink outline-none hover:bg-raised/60 focus:bg-raised" aria-label="Dataset name" />
        <span className="text-[12px] text-ink-3">{dirty ? 'Saving…' : `${ds.rows.length} rows · ${ds.columns.length} columns`}</span>
        <Button size="sm" icon={Plus} onClick={() => edit((d) => ({ ...d, rows: [...d.rows, Object.fromEntries(d.columns.map((c) => [c, '']))] }))}>
          Row
        </Button>
        <Button
          size="sm"
          icon={Plus}
          onClick={() =>
            edit((d) => {
              let name = `Column ${d.columns.length + 1}`;
              while (d.columns.includes(name)) name += '′';
              return { ...d, columns: [...d.columns, name], rows: d.rows.map((r) => ({ ...r, [name]: '' })) };
            })
          }
        >
          Column
        </Button>
        <Button size="sm" icon={Download} onClick={() => void api.datasets.exportCsv(ds.id).then((r) => r.path && toast.success('Exported', r.path))}>
          Export CSV
        </Button>
        <IconButton
          icon={Trash2}
          label="Delete dataset"
          tone="danger"
          onClick={async () => {
            if (await confirmDialog({ title: `Delete “${ds.name}”?`, description: 'Flows that read from it will run without dataset values.', confirm: 'Delete', tone: 'danger' })) {
              await api.datasets.delete(ds.id);
              onDeleted();
            }
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr>
              <th className="w-12 border-r border-b border-line px-2 py-1.5 text-right font-medium text-ink-3">#</th>
              {ds.columns.map((c, ci) => (
                <th key={ci} className="min-w-[160px] border-r border-b border-line p-0">
                  <div className="group flex items-center">
                    <input
                      value={c}
                      aria-label="Column name"
                      onChange={(e) =>
                        edit((d) => {
                          const name = e.target.value;
                          const cols = d.columns.slice();
                          cols[ci] = name;
                          return { ...d, columns: cols, rows: d.rows.map((r) => {
                            const { [c]: v, ...rest } = r;
                            return { ...rest, [name]: v ?? '' };
                          }) };
                        })
                      }
                      className="w-full bg-transparent px-2 py-1.5 font-medium text-ink-2 outline-none focus:bg-raised"
                    />
                    <button type="button" aria-label={`Remove column ${c}`} className="px-1.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-fail" onClick={() => edit((d) => ({ ...d, columns: d.columns.filter((x) => x !== c), rows: d.rows.map(({ [c]: _drop, ...rest }) => rest) }))}>
                      <X size={13} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {ds.rows.slice(0, 5000).map((r, ri) => (
              <tr key={ri} className="group">
                <td className="tnum border-r border-b border-line px-2 py-1 text-right text-ink-3">{ri + 1}</td>
                {ds.columns.map((c) => (
                  <td key={c} className="border-r border-b border-line p-0">
                    <input value={r[c] ?? ''} onChange={(e) => edit((d) => ({ ...d, rows: d.rows.map((row, j) => (j === ri ? { ...row, [c]: e.target.value } : row)) }))} className="w-full bg-transparent px-2 py-1 font-mono text-[11.5px] text-ink outline-none focus:bg-raised" aria-label={`${c}, row ${ri + 1}`} />
                  </td>
                ))}
                <td className="border-b border-line">
                  <button type="button" aria-label={`Remove row ${ri + 1}`} className="px-2 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-fail" onClick={() => edit((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== ri) }))}>
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ds.rows.length > 5000 && <p className="px-5 py-3 text-[12px] text-ink-3">Showing the first 5,000 of {ds.rows.length.toLocaleString()} rows. Every row is used when running.</p>}
      </div>
    </div>
  );
}

function DatasetsTab() {
  const datasets = useApp((s) => s.datasets);
  const [sel, setSel] = useState<string | null>(datasets[0]?.id ?? null);
  useEffect(() => {
    if (!sel && datasets[0]) setSel(datasets[0].id);
  }, [datasets, sel]);
  const importFile = async () => {
    try {
      const ds = await api.datasets.importFile();
      if (ds) {
        toast.success(`Imported “${ds.name}”`, `${ds.rows.length} rows, ${ds.columns.length} columns`);
        setSel(ds.id);
      }
    } catch (e) {
      toast.error('Import failed', errorMessage(e));
    }
  };
  const create = async () => {
    const now = Date.now();
    const ds = await api.datasets.save({ id: uid('d'), name: 'New dataset', columns: ['Email', 'Password'], rows: [{ Email: '', Password: '' }], createdAt: now, updatedAt: now });
    setSel(ds.id);
  };
  if (!datasets.length)
    return (
      <EmptyState
        icon={Table2}
        title="No datasets yet"
        action={
          <>
            <Button variant="primary" icon={FileUp} onClick={() => void importFile()}>
              Import CSV or JSON
            </Button>
            <Button icon={Plus} onClick={() => void create()}>
              Start an empty one
            </Button>
          </>
        }
      >
        A dataset is a table of values, like a list of test accounts. Each iteration of a run can use the next row, and steps read a column with “Dataset” as their value.
      </EmptyState>
    );
  return (
    <div className="flex h-full">
      <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
        <div className="flex gap-2 border-b border-line p-3">
          <Button size="sm" className="flex-1" icon={FileUp} onClick={() => void importFile()}>
            Import
          </Button>
          <Button size="sm" className="flex-1" icon={Plus} onClick={() => void create()}>
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {datasets.map((d) => (
            <button key={d.id} type="button" onClick={() => setSel(d.id)} className={cn('flex w-full flex-col rounded-lg px-3 py-2 text-left', sel === d.id ? 'bg-raised' : 'hover:bg-raised/50')}>
              <span className="truncate text-[13px] font-medium text-ink">{d.name}</span>
              <span className="truncate text-[12px] text-ink-3">
                {d.rowCount.toLocaleString()} rows · {d.columns.slice(0, 3).join(', ')}
                {d.columns.length > 3 ? '…' : ''} · {relativeTime(d.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">{sel && datasets.some((d) => d.id === sel) ? <DatasetEditor key={sel} id={sel} onDeleted={() => setSel(null)} /> : null}</div>
    </div>
  );
}

// ── Generator ──────────────────────────────────────────────────────────────

interface GenColumn {
  id: string;
  name: string;
  dataType: string;
  options?: Record<string, unknown>;
}

const PRESETS: { label: string; cols: [string, string][] }[] = [
  { label: 'People', cols: [['First name', 'person.firstName'], ['Last name', 'person.lastName'], ['Email', 'internet.email'], ['Phone', 'phone.number'], ['Date of birth', 'person.birthdate']] },
  { label: 'Accounts', cols: [['Username', 'internet.username'], ['Email', 'internet.email'], ['Password', 'internet.password']] },
  { label: 'Addresses', cols: [['Full name', 'person.fullName'], ['Street', 'address.street'], ['City', 'address.city'], ['State', 'address.stateAbbr'], ['ZIP', 'address.zip'], ['Country', 'address.country']] },
  { label: 'Card payments', cols: [['Name on card', 'finance.cardholder'], ['Card number', 'finance.creditCard'], ['Expiry', 'finance.expiry'], ['CVV', 'finance.cvv'], ['Amount', 'finance.amount']] },
  { label: 'Companies', cols: [['Company', 'company.name'], ['Website', 'company.website'], ['Contact', 'person.fullName'], ['Job title', 'person.jobTitle'], ['Email', 'internet.email']] },
];

function generateRows(cols: GenColumn[], count: number, locale: string, emailDomain?: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const counters = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const scope = createGeneratorScope(locale, { iteration: i + 1, emailDomain });
    scope.counters = counters;
    const row: Record<string, string> = {};
    for (const c of cols) row[c.name] = generateValue(c.dataType, c.options, scope, undefined, c.id);
    rows.push(row);
  }
  return rows;
}

function GeneratorTab() {
  const settings = useApp((s) => s.settings);
  const [cols, setCols] = useState<GenColumn[]>(() => PRESETS[0].cols.map(([name, dataType]) => ({ id: uid('c'), name, dataType })));
  const [count, setCount] = useState(100);
  const [locale, setLocale] = useState(settings.dataLocale);
  const [seed, setSeed] = useState(0);
  const [name, setName] = useState('Generated people');
  const preview = useMemo(() => generateRows(cols, Math.min(count, 15), locale, settings.emailDomain), [cols, count, locale, seed, settings.emailDomain]);

  const setCol = (id: string, patch: Partial<GenColumn>) => setCols((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const names = cols.map((c) => c.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);

  const save = async () => {
    const rows = generateRows(cols, count, locale, settings.emailDomain);
    const now = Date.now();
    const ds = await api.datasets.save({ id: uid('d'), name: name || 'Generated data', columns: names, rows, createdAt: now, updatedAt: now, source: 'generator' });
    toast.success(`Saved “${ds.name}”`, `${rows.length.toLocaleString()} rows are ready to drive runs.`);
  };
  const exportCsv = async () => {
    const r = await api.datasets.exportRows(name || 'generated-data', names, generateRows(cols, count, locale, settings.emailDomain));
    if (r.path) toast.success('Exported', r.path);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[420px_minmax(0,1fr)] gap-6 px-8 py-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setCols(p.cols.map(([n, d]) => ({ id: uid('c'), name: n, dataType: d })));
                  setName(`Generated ${p.label.toLowerCase()}`);
                }}
                className="h-7 rounded-md border border-line px-2.5 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            {cols.map((c) => {
              const def = getDataType(c.dataType);
              return (
                <div key={c.id} className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <Input inputSize="sm" value={c.name} onChange={(e) => setCol(c.id, { name: e.target.value })} className="w-[130px]" aria-label="Column name" />
                  <div className="min-w-0 flex-1">
                    <DataTypePicker value={c.dataType} onChange={(d) => setCol(c.id, { dataType: d, options: undefined })} />
                  </div>
                  {def?.options?.length ? (
                    <Popover align="end" className="w-[340px] p-4" trigger={<IconButton icon={SlidersHorizontal} label="Options" size="sm" />}>
                      <DataOptionsForm def={def} options={c.options} onChange={(o) => setCol(c.id, { options: o })} />
                    </Popover>
                  ) : (
                    <span className="w-6" />
                  )}
                  <IconButton icon={Trash2} label="Remove column" size="sm" tone="danger" onClick={() => setCols((cs) => cs.filter((x) => x.id !== c.id))} />
                </div>
              );
            })}
            <button type="button" onClick={() => setCols((cs) => [...cs, { id: uid('c'), name: `Column ${cs.length + 1}`, dataType: 'text.words' }])} className="flex w-full items-center gap-2 px-3 py-2.5 text-[12.5px] text-ink-3 hover:bg-raised/50 hover:text-accent">
              <Plus size={14} /> Add column
            </button>
          </div>
          {dupes.length > 0 && <p className="text-[12px] text-fail">Column names must be unique: {[...new Set(dupes)].join(', ')}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rows">
              <NumberInput value={count} min={1} max={100000} step={10} onChange={(n) => setCount(Math.round(n))} ariaLabel="Rows" />
            </Field>
            <Field label="Style">
              <Select value={locale} onChange={setLocale} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
            </Field>
          </div>
          <Field label="Dataset name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" icon={Save} disabled={!cols.length || dupes.length > 0} onClick={() => void save()}>
              Save {count.toLocaleString()} rows as dataset
            </Button>
            <Button icon={Download} disabled={!cols.length || dupes.length > 0} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-3">Within a row, names, emails, usernames and addresses belong to the same generated person.</p>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Preview</h3>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setSeed((s) => s + 1)}>
              New sample
            </Button>
          </div>
          <div className="overflow-auto rounded-xl border border-line bg-panel">
            <table className="selectable w-max min-w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.id} className="border-b border-line px-3 py-2 text-left font-medium whitespace-nowrap text-ink-3">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c.id} className="max-w-[240px] truncate border-b border-line px-3 py-1.5 font-mono text-[11.5px] text-ink">
                        {r[c.name]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CatalogTab() {
  const locale = useApp((s) => s.settings.dataLocale);
  const [q, setQ] = useState('');
  const [seed, setSeed] = useState(0);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return DATA_TYPES.filter((d) => !n || `${d.label} ${d.description} ${d.keywords ?? ''} ${d.category}`.toLowerCase().includes(n));
  }, [q]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-8 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${DATA_TYPES.length} data types`} className="w-[320px]" />
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setSeed((s) => s + 1)}>
            New examples
          </Button>
        </div>
        {CATEGORIES.map((cat) => {
          const items = list.filter((d) => d.category === cat.id);
          if (!items.length) return null;
          const Icon = CATEGORY_ICONS[cat.id];
          return (
            <section key={cat.id} className="mb-6">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Icon size={15} className="text-ink-3" /> {cat.label}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {items.map((d) => (
                  <div key={`${d.id}-${seed}`} className="rounded-lg border border-line bg-panel px-3 py-2.5">
                    <p className="text-[13px] font-medium text-ink">{d.label}</p>
                    <p className="text-[12px] text-ink-3">{d.description}</p>
                    {!d.runtime && <p className="selectable mt-1.5 truncate font-mono text-[11.5px] text-ink-2">{sampleValues(d.id, undefined, locale, 1)[0]}</p>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function DataPage() {
  const { query } = useRoute();
  const [tab, setTab] = useState<'datasets' | 'generate' | 'catalog'>(query.get('generate') ? 'generate' : 'datasets');
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Test data" description="Datasets to drive runs row by row, a generator for realistic fake data, and every data type the recorder can suggest.">
        <Tabs
          className="-mb-5 mt-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'datasets', label: 'Datasets' },
            { value: 'generate', label: 'Generate data' },
            { value: 'catalog', label: 'Data types' },
          ]}
        />
      </PageHeader>
      <div className="min-h-0 flex-1">
        {tab === 'datasets' && <DatasetsTab />}
        {tab === 'generate' && <GeneratorTab />}
        {tab === 'catalog' && <CatalogTab />}
      </div>
    </div>
  );
}

export const DATA_ICON = Database;
