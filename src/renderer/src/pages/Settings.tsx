import { Check, Download, FolderOpen, Info, KeyRound, Keyboard, Monitor, MousePointerClick, Play, RefreshCw, Shuffle, SlidersHorizontal, Trash2, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { relativeTime } from '@shared/data/format';
import { LOCALES } from '@shared/data/locales';
import type { Settings } from '@shared/types';
import { RunOptionsForm } from '@/components/RunOptions';
import { Badge, Button, Field, IconButton, Input, Kbd, NumberInput, Segmented, Select, Switch, confirmDialog, cn } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApp } from '@/store/app';
import { toast } from '@/store/toasts';

type SectionId = 'general' | 'browser' | 'recording' | 'playback' | 'data' | 'logins' | 'storage' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: typeof Monitor }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'browser', label: 'Browser', icon: Monitor },
  { id: 'recording', label: 'Recording', icon: MousePointerClick },
  { id: 'playback', label: 'Run defaults', icon: Play },
  { id: 'data', label: 'Generated data', icon: Shuffle },
  { id: 'logins', label: 'Saved logins', icon: KeyRound },
  { id: 'storage', label: 'Storage', icon: Wrench },
  { id: 'about', label: 'About and shortcuts', icon: Info },
];

function Row({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <h2 className="mb-2 text-[13px] font-semibold text-ink-2">{title}</h2>}
      <div className="rounded-xl border border-line bg-panel px-5">{children}</div>
    </section>
  );
}

function BrowserSection({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const browsers = useApp((st) => st.browsers);
  const refresh = useApp((st) => st.refreshBrowsers);
  const [installing, setInstalling] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => api.app.onInstallProgress((l) => setLines((x) => [...x.slice(-200), l])), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);
  const install = async () => {
    setInstalling(true);
    setLines([]);
    const r = await api.app.installChromium();
    setInstalling(false);
    await refresh();
    if (r.ok) toast.success('Chromium downloaded', r.message);
    else toast.error('Chromium download failed', r.message);
  };
  return (
    <>
      <Card title="Default browser">
        <div className="flex flex-col py-2">
          {browsers.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={!b.available}
              onClick={() => set({ browser: b.id, runDefaults: { ...s.runDefaults, browser: b.id } })}
              className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-left disabled:cursor-not-allowed', s.browser === b.id ? 'bg-accent-soft' : b.available ? 'hover:bg-raised' : 'opacity-60')}
            >
              <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', s.browser === b.id ? 'border-accent bg-accent text-white' : 'border-line-strong')}>{s.browser === b.id && <Check size={11} strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{b.name}</span>
                <span className="block truncate font-mono text-[11.5px] text-ink-3">{b.path ?? b.note ?? 'Not installed'}</span>
              </span>
              {b.available ? <Badge tone="pass">Installed</Badge> : <Badge>Not available</Badge>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line py-3">
          <Button size="sm" icon={RefreshCw} onClick={() => void refresh()}>
            Check again
          </Button>
          <Button
            size="sm"
            icon={FolderOpen}
            onClick={async () => {
              const p = await api.app.chooseExecutable();
              if (p) {
                set({ customBrowserPath: p, browser: 'custom', runDefaults: { ...s.runDefaults, browser: 'custom' } });
                setTimeout(() => void refresh(), 200);
              }
            }}
          >
            Use another Chromium browser…
          </Button>
          <Button size="sm" icon={Download} loading={installing} onClick={() => void install()}>
            Download Chromium
          </Button>
        </div>
        {lines.length > 0 && (
          <div ref={logRef} className="selectable mb-3 max-h-40 overflow-y-auto rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11px] text-ink-3">
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Behavior">
        <Row title="Hide the “controlled by automated software” banner" description="Keeps the browser window looking normal while recording and running.">
          <Switch checked={s.hideAutomationBanner} onChange={(b) => set({ hideAutomationBanner: b })} ariaLabel="Hide automation banner" />
        </Row>
      </Card>
    </>
  );
}

function LoginsSection() {
  const sessions = useApp((s) => s.sessions);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  if (!sessions.length)
    return (
      <Card>
        <p className="py-6 text-[13px] text-ink-3">No saved logins. Open a flow’s live browser, sign in, then choose “Save login” in the bar above the steps.</p>
      </Card>
    );
  return (
    <Card>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
          <KeyRound size={16} className="text-ink-3" />
          <div className="min-w-0 flex-1">
            {editing === s.id ? (
              <Input
                inputSize="sm"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (name.trim()) void api.sessions.rename(s.id, name.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <button type="button" className="text-left text-[13px] font-medium text-ink hover:underline" onClick={() => (setEditing(s.id), setName(s.name))}>
                {s.name}
              </button>
            )}
            <p className="truncate text-[12px] text-ink-3">
              {s.cookieCount} cookies · {s.origins.slice(0, 4).join(', ') || 'no sites'} · saved {relativeTime(s.createdAt)}
            </p>
          </div>
          <IconButton
            icon={Trash2}
            label="Delete saved login"
            tone="danger"
            onClick={async () => {
              if (await confirmDialog({ title: `Delete “${s.name}”?`, description: 'Runs that start with it will start logged out.', confirm: 'Delete', tone: 'danger' })) await api.sessions.delete(s.id);
            }}
          />
        </div>
      ))}
    </Card>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search flows, runs and actions'],
  ['Ctrl N', 'New recording'],
  ['Ctrl ,', 'Settings'],
  ['Ctrl Enter', 'Run the open flow'],
  ['F5', 'Play the open flow in the browser'],
  ['Ctrl Z / Ctrl Y', 'Undo / redo in the editor'],
  ['↑ ↓', 'Move between steps'],
  ['Alt ↑ / Alt ↓', 'Move the selected steps'],
  ['Ctrl D', 'Duplicate steps'],
  ['Ctrl C / Ctrl V', 'Copy and paste steps, also between flows'],
  ['Delete', 'Delete selected steps'],
  ['Esc', 'Cancel picking an element in the browser'],
];

export function SettingsPage() {
  const s = useApp((st) => st.settings);
  const info = useApp((st) => st.info);
  const update = useApp((st) => st.updateSettings);
  const [section, setSection] = useState<SectionId>('general');
  const set = (p: Partial<Settings>) => void update(p).catch((e) => toast.error(errorMessage(e)));

  return (
    <div className="flex h-full">
      <nav className="w-[230px] shrink-0 border-r border-line px-3 py-6" aria-label="Settings sections">
        <h1 className="mb-4 px-2.5 text-[20px] font-semibold tracking-[-0.015em] text-ink">Settings</h1>
        {SECTIONS.map((x) => (
          <button key={x.id} type="button" onClick={() => setSection(x.id)} className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px]', section === x.id ? 'bg-raised font-medium text-ink' : 'text-ink-2 hover:bg-raised/60 hover:text-ink')}>
            <x.icon size={15} className={section === x.id ? 'text-accent' : 'text-ink-3'} />
            {x.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-[820px] px-10 py-8">
          {section === 'general' && (
            <Card>
              <Row title="Theme">
                <Segmented
                  value={s.theme}
                  onChange={(t) => set({ theme: t })}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                    { value: 'system', label: 'Match Windows' },
                  ]}
                />
              </Row>
              <Row title="Keep running in the tray when the window closes" description="Needed for schedules to run while the window is closed. Quit from the tray icon.">
                <Switch checked={s.closeToTray} onChange={(b) => set({ closeToTray: b })} ariaLabel="Close to tray" />
              </Row>
              <Row title="Start with Windows" description="Starts minimized to the tray so schedules run after you sign in.">
                <Switch checked={s.launchAtLogin} onChange={(b) => set({ launchAtLogin: b })} ariaLabel="Start with Windows" />
              </Row>
              <Row title="Notify me when a run finishes" description="Only shown when the Xero window is not in front.">
                <Switch checked={s.notifications} onChange={(b) => set({ notifications: b })} ariaLabel="Notifications" />
              </Row>
            </Card>
          )}

          {section === 'browser' && <BrowserSection s={s} set={set} />}

          {section === 'recording' && (
            <Card>
              <Row title="Show the recording toolbar on the page" description="The floating bar with Pause, Check, Save text, Hover and Stop.">
                <Switch checked={s.recorder.showToolbar} onChange={(b) => set({ recorder: { ...s.recorder, showToolbar: b } })} ariaLabel="Show toolbar" />
              </Row>
              <Row title="Flash elements as they are recorded" description="A short outline confirms which element a step will use.">
                <Switch checked={s.recorder.highlightRecorded} onChange={(b) => set({ recorder: { ...s.recorder, highlightRecorded: b } })} ariaLabel="Highlight recorded elements" />
              </Row>
              <Row title="Use generated data right away" description="Fields that clearly match a data type switch to generated values while you record, instead of asking afterwards.">
                <Switch checked={s.recorder.autoRandomize} onChange={(b) => set({ recorder: { ...s.recorder, autoRandomize: b } })} ariaLabel="Auto generated data" />
              </Row>
              <Row title="Record scrolling" description="Useful for pages that load more content as you scroll. Elements are scrolled into view automatically either way.">
                <Switch checked={s.recorder.recordScroll} onChange={(b) => set({ recorder: { ...s.recorder, recordScroll: b } })} ariaLabel="Record scrolling" />
              </Row>
              <Row title="Record the Tab key" description="Turn on for forms that react when you tab out of a field.">
                <Switch checked={s.recorder.recordTab} onChange={(b) => set({ recorder: { ...s.recorder, recordTab: b } })} ariaLabel="Record Tab key" />
              </Row>
              <Row title="When a page opens an alert or confirmation">
                <div className="w-[200px]">
                  <Select
                    value={s.recorder.dialogs}
                    onChange={(d) => set({ recorder: { ...s.recorder, dialogs: d } })}
                    options={[
                      { value: 'ask', label: 'Ask me' },
                      { value: 'accept', label: 'Always accept' },
                      { value: 'dismiss', label: 'Always dismiss' },
                    ]}
                  />
                </div>
              </Row>
            </Card>
          )}

          {section === 'playback' && (
            <>
              <p className="mb-4 text-[13px] text-ink-2">Used for new flows and anything a flow does not set itself.</p>
              <div className="rounded-xl border border-line bg-panel p-6">
                <RunOptionsForm value={s.runDefaults} onChange={(p) => set({ runDefaults: { ...s.runDefaults, ...p } })} />
              </div>
            </>
          )}

          {section === 'data' && (
            <Card>
              <Row title="Style of generated data" description="Names, addresses, phone numbers and postal codes follow this country.">
                <div className="w-[240px]">
                  <Select value={s.dataLocale} onChange={(l) => set({ dataLocale: l, runDefaults: { ...s.runDefaults, dataLocale: l } })} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
                </div>
              </Row>
              <Row title="Domain for generated emails" description="Leave empty for everyday providers like gmail.com. Use a domain you control, or a catch-all test inbox, when the site sends real emails.">
                <Input className="w-[240px]" value={s.emailDomain ?? ''} placeholder="e.g. test.mycompany.com" onChange={(e) => set({ emailDomain: e.target.value.trim() || undefined })} />
              </Row>
              <Row title="Hide passwords on screen" description="Masks recorded and generated passwords in steps, reports and tables.">
                <Switch checked={s.maskSecrets} onChange={(b) => set({ maskSecrets: b })} ariaLabel="Mask passwords" />
              </Row>
            </Card>
          )}

          {section === 'logins' && <LoginsSection />}

          {section === 'storage' && (
            <Card>
              <Row title="Data folder" description={<span className="selectable font-mono text-[11.5px]">{info?.dataDir}</span>}>
                <Button size="sm" icon={FolderOpen} onClick={() => void api.app.revealDataFolder()}>
                  Open folder
                </Button>
              </Row>
              <Row title="Runs to keep" description="Older run reports and their screenshots are deleted automatically.">
                <NumberInput className="w-32" value={s.keepRuns} min={10} max={5000} step={10} onChange={(n) => set({ keepRuns: Math.round(n) })} />
              </Row>
              <Row title="Run history" description="Removes every finished run and its screenshots.">
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  onClick={async () => {
                    if (await confirmDialog({ title: 'Clear all run history?', confirm: 'Clear history', tone: 'danger' })) {
                      await api.runs.clear();
                      toast.info('Run history cleared');
                    }
                  }}
                >
                  Clear history
                </Button>
              </Row>
            </Card>
          )}

          {section === 'about' && (
            <>
              <Card title="Xero Browser Automation">
                {info && (
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-2 py-4 text-[12.5px]">
                    {(
                      [
                        ['Version', info.version],
                        ['Browser engine', `Playwright ${info.playwright}`],
                        ['Electron', info.electron],
                        ['Chromium', info.chrome],
                        ['Node.js', info.node],
                        ['Platform', info.platform],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-line pb-2">
                        <dt className="text-ink-3">{k}</dt>
                        <dd className="selectable font-mono text-[11.5px] text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
              <Card title="Keyboard shortcuts">
                <div className="py-2">
                  {SHORTCUTS.map(([k, d]) => (
                    <div key={k} className="flex items-center justify-between border-b border-line py-2 last:border-b-0">
                      <span className="text-[13px] text-ink-2">{d}</span>
                      <span className="flex gap-1">
                        {k.split(' / ').map((x) => (
                          <Kbd key={x}>{x}</Kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <p className="flex items-center gap-2 text-[12.5px] text-ink-3">
                <Keyboard size={14} /> Tip: everything you can do from a menu is also in the command palette.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
