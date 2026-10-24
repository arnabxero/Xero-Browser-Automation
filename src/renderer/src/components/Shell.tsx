import { CalendarClock, CircleCheck, CircleX, Database, History, Info, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search, Settings, TriangleAlert, Workflow, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { navigate, useRoute } from '@/lib/router';
import { isActiveRun, useApp } from '@/store/app';
import { useToasts } from '@/store/toasts';
import { Button, Kbd, Tooltip, cn } from './ui';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M10 9.5 22 22.5M22 9.5 10 22.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="24.5" cy="7.5" r="3.6" fill="var(--rec)" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

export function TitleBar() {
  const setPalette = useApp((s) => s.setPalette);
  return (
    <div className="drag relative z-40 flex h-11 shrink-0 items-center border-b border-line bg-canvas pr-[150px] pl-3">
      <div className="flex w-[200px] items-center gap-2.5">
        <Logo />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">Xero</span>
        <span className="text-[12px] text-ink-3">Browser Automation</span>
      </div>
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="no-drag flex h-7 w-[min(440px,40vw)] items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search flows, runs and actions</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </div>
  );
}

interface NavItem {
  path: string;
  label: string;
  icon: typeof Workflow;
  badge?: ReactNode;
}

export function Sidebar() {
  const { parts } = useRoute();
  const collapsed = useApp((s) => s.settings.sidebarCollapsed);
  const updateSettings = useApp((s) => s.updateSettings);
  const runs = useApp((s) => s.runs);
  const live = useApp((s) => s.live);
  const flows = useApp((s) => s.flows);
  const active = runs.filter(isActiveRun).length;
  const section = parts[0] ?? '';

  const items: NavItem[] = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/flows', label: 'Flows', icon: Workflow, badge: flows.length || undefined },
    {
      path: '/runs',
      label: 'Runs',
      icon: History,
      badge: active ? (
        <span className="flex items-center gap-1 text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {active}
        </span>
      ) : undefined,
    },
    { path: '/data', label: 'Test data', icon: Database },
    { path: '/schedules', label: 'Schedules', icon: CalendarClock },
  ];

  const isOn = (p: string) => (p === '/' ? section === '' : `/${section}` === p);
  const liveFlow = live.flowId ? flows.find((f) => f.id === live.flowId) : undefined;

  const link = (it: NavItem) => {
    const on = isOn(it.path);
    const el = (
      <button
        key={it.path}
        type="button"
        onClick={() => navigate(it.path)}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
          on ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
          collapsed && 'justify-center px-0',
        )}
      >
        <it.icon size={16} className={on ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2'} />
        {!collapsed && <span className="flex-1 text-left">{it.label}</span>}
        {!collapsed && it.badge !== undefined && <span className="tnum text-[11.5px] text-ink-3">{it.badge}</span>}
      </button>
    );
    return collapsed ? (
      <Tooltip key={it.path} content={it.label} side="right">
        {el}
      </Tooltip>
    ) : (
      el
    );
  };

  return (
    <nav className={cn('flex shrink-0 flex-col border-r border-line bg-canvas py-3 transition-[width] duration-150', collapsed ? 'w-[60px] px-2' : 'w-[216px] px-3')} aria-label="Main">
      <Tooltip content={collapsed ? 'New recording' : undefined} side="right">
        <Button variant="rec" className={cn('mb-4 w-full', collapsed && 'px-0')} onClick={() => navigate('/record')}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white" />
          {!collapsed && 'New recording'}
        </Button>
      </Tooltip>
      <div className="flex flex-col gap-0.5">{items.map(link)}</div>

      <div className="mt-auto flex flex-col gap-2">
        {live.mode !== 'closed' && !collapsed && (
          <button
            type="button"
            onClick={() => live.flowId && navigate(`/flows/${live.flowId}`)}
            className="rounded-lg border border-line bg-panel p-2.5 text-left transition-colors hover:border-line-strong"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <span className={cn('h-2 w-2 rounded-full', live.mode === 'recording' ? 'rec-pulse bg-rec' : live.mode === 'playing' ? 'bg-accent' : 'bg-pass')} />
              {live.mode === 'recording' ? 'Recording' : live.mode === 'paused' ? 'Recording paused' : live.mode === 'playing' ? 'Playing back' : live.mode === 'starting' ? 'Opening browser…' : 'Browser open'}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{liveFlow?.name ?? 'Live browser'}</div>
          </button>
        )}
        {link({ path: '/settings', label: 'Settings', icon: Settings })}
        <button
          type="button"
          onClick={() => void updateSettings({ sidebarCollapsed: !collapsed })}
          className={cn('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] text-ink-3 hover:bg-raised/60 hover:text-ink-2', collapsed && 'justify-center px-0')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </nav>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const icons = { info: Info, success: CircleCheck, warn: TriangleAlert, error: CircleX };
  const tones = { info: 'text-accent', success: 'text-pass', warn: 'text-warn', error: 'text-fail' };
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[360px] flex-col gap-2" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div key={t.id} className="pop-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 shadow-pop">
            <Icon size={17} className={cn('mt-px shrink-0', tones[t.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.description && <p className="selectable mt-0.5 text-[12.5px] leading-snug break-words text-ink-2">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 text-[12.5px] font-medium text-accent hover:underline"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mt-0.5 -mr-1 rounded p-1 text-ink-3 hover:bg-raised hover:text-ink">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
