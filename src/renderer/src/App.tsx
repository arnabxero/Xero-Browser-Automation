import { useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { RunDialog } from './components/RunOptions';
import { Sidebar, TitleBar, Toaster } from './components/Shell';
import { ConfirmHost, Spinner, TooltipProvider } from './components/ui';
import { useHotkeys } from './lib/hotkeys';
import { navigate, useRoute } from './lib/router';
import { Dashboard } from './pages/Dashboard';
import { DataPage } from './pages/Data';
import { FlowEditor } from './pages/editor/FlowEditor';
import { FlowsPage } from './pages/Flows';
import { RecordPage } from './pages/Record';
import { RunDetail } from './pages/RunDetail';
import { RunsPage } from './pages/Runs';
import { SchedulesPage } from './pages/Schedules';
import { SettingsPage } from './pages/Settings';
import { useApp } from './store/app';
import { wireRecording } from './store/recording';

function Page() {
  const { parts } = useRoute();
  const [a, b] = parts;
  switch (a) {
    case undefined:
      return <Dashboard />;
    case 'flows':
      return b ? <FlowEditor key={b} id={b} /> : <FlowsPage />;
    case 'record':
      return <RecordPage />;
    case 'runs':
      return b ? <RunDetail key={b} id={b} /> : <RunsPage />;
    case 'data':
      return <DataPage />;
    case 'schedules':
      return <SchedulesPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <Dashboard />;
  }
}

export function App() {
  const ready = useApp((s) => s.ready);
  const setPalette = useApp((s) => s.setPalette);

  useEffect(() => {
    wireRecording();
    void useApp.getState().init();
  }, []);

  useHotkeys({
    'mod+k': () => setPalette(!useApp.getState().paletteOpen),
    'mod+n': () => navigate('/record'),
    'mod+,': () => navigate('/settings'),
  });

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="relative min-w-0 flex-1 overflow-hidden bg-canvas">
            {ready ? (
              <Page />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Spinner size={22} />
              </div>
            )}
          </main>
        </div>
      </div>
      <Toaster />
      <CommandPalette />
      <RunDialog />
      <ConfirmHost />
    </TooltipProvider>
  );
}
