import { FlaskConical, Globe, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { BrowserChoice } from '@shared/types';
import { errorMessage } from '@/lib/api';
import { useApp } from '@/store/app';
import { startNewRecording } from '@/store/recording';
import { toast } from '@/store/toasts';
import { Button, Input, Select, cn } from './ui';

export function RecordBar({ initialUrl = '', autoFocus, size = 'lg', showName }: { initialUrl?: string; autoFocus?: boolean; size?: 'md' | 'lg'; showName?: boolean }) {
  const settings = useApp((s) => s.settings);
  const browsers = useApp((s) => s.browsers);
  const sessions = useApp((s) => s.sessions);
  const info = useApp((s) => s.info);
  const live = useApp((s) => s.live);
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState('');
  const [browser, setBrowser] = useState<BrowserChoice>(settings.browser);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const busyLive = live.mode === 'recording' || live.mode === 'starting' || live.mode === 'playing';

  const start = async (target = url) => {
    if (!target.trim()) {
      toast.warn('Enter a website address to record');
      return;
    }
    setBusy(true);
    try {
      await startNewRecording({ url: target, name, browser, sessionId: sessionId || undefined });
    } catch (e) {
      toast.error('Recording could not start', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className={cn('flex items-center gap-2 rounded-2xl border border-line bg-panel p-2 shadow-[0_1px_0_rgb(255_255_255/0.03)_inset] focus-within:border-accent-line', size === 'lg' && 'p-2.5')}
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <Input
          icon={Globe}
          inputSize={size === 'lg' ? 'lg' : 'md'}
          autoFocus={autoFocus}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste the address of the site to record, e.g. shop.example.com/signup"
          className="min-w-0 flex-1 [&_input]:border-transparent [&_input]:bg-transparent [&_input]:hover:border-transparent [&_input]:focus:ring-0"
          aria-label="Website address"
        />
        <div className="w-[150px] shrink-0">
          <Select
            value={browser}
            onChange={setBrowser}
            ariaLabel="Browser"
            options={browsers.map((b) => ({ value: b.id, label: b.name, disabled: !b.available, hint: b.available ? undefined : (b.note ?? 'Not installed') }))}
          />
        </div>
        {sessions.length > 0 && (
          <div className="w-[170px] shrink-0">
            <Select value={sessionId} onChange={setSessionId} ariaLabel="Start logged in" options={[{ value: '', label: 'Logged out', icon: KeyRound }, ...sessions.map((s) => ({ value: s.id, label: s.name, icon: KeyRound }))]} />
          </div>
        )}
        <Button type="submit" variant="rec" size={size === 'lg' ? 'lg' : 'md'} loading={busy} disabled={busyLive}>
          {!busy && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
          Start recording
        </Button>
      </form>
      {showName && (
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flow name (optional), e.g. Checkout with a new customer" aria-label="Flow name" />
      )}
      {info && (
        <button type="button" onClick={() => void start(info.playgroundUrl)} className="flex items-center gap-1.5 self-start text-[12.5px] text-ink-3 hover:text-accent">
          <FlaskConical size={14} /> No site in mind? Record the built-in practice form
        </button>
      )}
    </div>
  );
}
