import { Command } from 'cmdk';
import { CalendarClock, Database, FileDown, FlaskConical, History, LayoutDashboard, Moon, Play, Settings, Sun, Workflow } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { relativeTime } from '@shared/data/format';
import { api, errorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { resolvedTheme, useApp } from '@/store/app';
import { toast } from '@/store/toasts';
import { useUi } from '@/store/ui';
import { Kbd } from './ui';
import { RunStatusBadge } from './visuals';

function Item({ icon: Icon, children, onSelect, hint, shortcut, value }: { icon: typeof Play; children: ReactNode; onSelect: () => void; hint?: ReactNode; shortcut?: string; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink data-[selected=true]:bg-raised">
      <Icon size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[12px] text-ink-3">{hint}</span>}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Command.Item>
  );
}

const group = 'text-[11.5px] font-medium text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1';

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPalette);
  const flows = useApp((s) => s.flows);
  const runs = useApp((s) => s.runs);
  const settings = useApp((s) => s.settings);
  const info = useApp((s) => s.info);
  const updateSettings = useApp((s) => s.updateSettings);
  const openRun = useUi((s) => s.openRunDialog);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const theme = resolvedTheme(settings);

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fade-in fixed inset-0 z-50 bg-[var(--scrim)]" />
        <RDialog.Content className="pop-in fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <RDialog.Description className="sr-only">Search flows, runs and actions</RDialog.Description>
          <Command loop label="Command palette">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search flows…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] text-ink outline-none placeholder:text-ink-3"
            />
            <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
              <Command.Empty className="px-4 py-8 text-center text-[13px] text-ink-3">Nothing matches “{query}”.</Command.Empty>
              <Command.Group heading="Actions" className={group}>
                <Item icon={Workflow} shortcut="Ctrl N" onSelect={() => go(() => navigate('/record'))}>
                  New recording
                </Item>
                {info && (
                  <Item icon={FlaskConical} onSelect={() => go(() => navigate(`/record?url=${encodeURIComponent(info.playgroundUrl)}`))}>
                    Record the practice form
                  </Item>
                )}
                <Item
                  icon={FileDown}
                  onSelect={() =>
                    go(async () => {
                      try {
                        const list = await api.flows.importFiles();
                        if (list.length) toast.success(`Imported ${list.length} flow${list.length === 1 ? '' : 's'}`);
                      } catch (e) {
                        toast.error('Import failed', errorMessage(e));
                      }
                    })
                  }
                >
                  Import flows from file
                </Item>
                <Item icon={Database} onSelect={() => go(() => navigate('/data?generate=1'))}>
                  Generate test data
                </Item>
                <Item icon={theme === 'dark' ? Sun : Moon} onSelect={() => go(() => void updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' }))}>
                  Switch to {theme === 'dark' ? 'light' : 'dark'} theme
                </Item>
              </Command.Group>
              {flows.length > 0 && (
                <Command.Group heading="Flows" className={group}>
                  {flows.slice(0, 50).map((f) => (
                    <Item key={f.id} value={`open ${f.name} ${f.domain ?? ''} ${f.id}`} icon={Workflow} hint={f.domain} onSelect={() => go(() => navigate(`/flows/${f.id}`))}>
                      {f.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {query && flows.length > 0 && (
                <Command.Group heading="Run" className={group}>
                  {flows.slice(0, 50).map((f) => (
                    <Item key={f.id} value={`run ${f.name} ${f.id}`} icon={Play} hint={`${f.stepCount} steps`} onSelect={() => go(() => openRun(f.id))}>
                      Run {f.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {runs.length > 0 && (
                <Command.Group heading="Recent runs" className={group}>
                  {runs.slice(0, 6).map((r) => (
                    <Command.Item
                      key={r.id}
                      value={`run result ${r.flowName} ${r.id}`}
                      onSelect={() => go(() => navigate(`/runs/${r.id}`))}
                      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink data-[selected=true]:bg-raised"
                    >
                      <History size={16} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{r.flowName}</span>
                      <span className="text-[12px] text-ink-3">{relativeTime(r.startedAt)}</span>
                      <RunStatusBadge status={r.status} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={group}>
                <Item icon={LayoutDashboard} onSelect={() => go(() => navigate('/'))}>
                  Home
                </Item>
                <Item icon={Workflow} onSelect={() => go(() => navigate('/flows'))}>
                  Flows
                </Item>
                <Item icon={History} onSelect={() => go(() => navigate('/runs'))}>
                  Runs
                </Item>
                <Item icon={Database} onSelect={() => go(() => navigate('/data'))}>
                  Test data
                </Item>
                <Item icon={CalendarClock} onSelect={() => go(() => navigate('/schedules'))}>
                  Schedules
                </Item>
                <Item icon={Settings} shortcut="Ctrl ," onSelect={() => go(() => navigate('/settings'))}>
                  Settings
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
