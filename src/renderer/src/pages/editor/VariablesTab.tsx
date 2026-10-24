import { Plus, Trash2, Variable } from 'lucide-react';
import { stepTitle } from '@shared/steps';
import { Button, EmptyState, IconButton, Input, Section } from '@/components/ui';
import { useEditor } from '@/store/editor';

export function VariablesTab() {
  const flow = useEditor((s) => s.flow)!;
  const update = useEditor((s) => s.update);
  const lastVars = useEditor((s) => s.lastVars);
  const select = useEditor((s) => s.select);

  const produced = flow.steps
    .map((s, i) => {
      const name = s.extract?.variable ?? (s.type === 'setVariable' ? s.variable : undefined) ?? s.value?.saveAs ?? s.resultVariable;
      return name ? { name, step: s, index: i } : null;
    })
    .filter(Boolean) as { name: string; step: (typeof flow.steps)[number]; index: number }[];

  const setVar = (i: number, patch: Partial<(typeof flow.variables)[number]>, key: string) =>
    update(
      (f) => {
        Object.assign(f.variables[i], patch);
      },
      { key: `var:${i}:${key}` },
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5 px-8 py-6">
        <Section
          title="Flow variables"
          description="Values you set once and reuse in any step as {{var.name}}, such as a base URL or a test account. Values can use templates."
          actions={
            <Button size="sm" icon={Plus} onClick={() => update((f) => void f.variables.push({ name: `var${f.variables.length + 1}`, value: '' }))}>
              Add variable
            </Button>
          }
        >
          {flow.variables.length ? (
            <div className="divide-y divide-line">
              {flow.variables.map((v, i) => (
                <div key={i} className="grid grid-cols-[200px_minmax(0,1fr)_minmax(0,0.8fr)_32px] items-center gap-3 px-4 py-2.5">
                  <Input mono value={v.name} onChange={(e) => setVar(i, { name: e.target.value.replace(/[^\w]/g, '') }, 'name')} aria-label="Variable name" />
                  <Input mono value={v.value} onChange={(e) => setVar(i, { value: e.target.value }, 'value')} placeholder="Value or {{template}}" aria-label="Value" type={v.secret ? 'password' : 'text'} />
                  <Input value={v.description ?? ''} onChange={(e) => setVar(i, { description: e.target.value }, 'desc')} placeholder="What it is for" aria-label="Description" />
                  <IconButton icon={Trash2} label="Remove variable" tone="danger" onClick={() => update((f) => void f.variables.splice(i, 1))} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Variable} title="No flow variables" className="py-10">
              Add one to keep a value in a single place, for example the site’s address for staging and production.
            </EmptyState>
          )}
        </Section>

        <Section title="Saved by steps" description="These variables get their value while the flow runs.">
          {produced.length ? (
            <div className="divide-y divide-line">
              {produced.map((p) => (
                <button key={p.step.id} type="button" onClick={() => select(p.step.id)} className="grid w-full grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 text-left hover:bg-raised/50">
                  <span className="font-mono text-[12.5px] text-accent">{p.name}</span>
                  <span className="truncate text-[12.5px] text-ink-2">
                    Step {p.index + 1}: {stepTitle(p.step)}
                  </span>
                  <span className="selectable truncate font-mono text-[12px] text-ink-3">{lastVars[p.name] !== undefined ? `Last value: ${lastVars[p.name]}` : 'Not run yet'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-[12.5px] text-ink-3">Use “Save value”, “Set variable”, or “Save the typed value as a variable” on a typing step to create one.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
