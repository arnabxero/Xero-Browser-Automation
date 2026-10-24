import { Globe, KeyRound, Link2, Pause, Play, Square, StepForward, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Dialog, Field, IconButton, Input, cn } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { recordInto, stopRecording } from '@/store/recording';
import { toast } from '@/store/toasts';

function Timer({ since }: { since?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <span className="tnum">{`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`}</span>;
}

export function SaveSessionDialog({ open, onOpenChange, defaultName }: { open: boolean; onOpenChange: (o: boolean) => void; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  const save = async () => {
    try {
      const s = await api.live.saveSession(name.trim() || defaultName);
      if (s) toast.success('Login saved', `${s.cookieCount} cookies from ${s.origins.slice(0, 3).join(', ') || 'this browser'}. Choose it under “Start logged in” when running.`);
      onOpenChange(false);
    } catch (e) {
      toast.error('Could not save the login', errorMessage(e));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={KeyRound}
      title="Save this browser’s login"
      description="Stores the cookies and local storage of the open browser. Runs that start with it skip the sign-in steps. Anyone with access to this computer can use it."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save login
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </Field>
    </Dialog>
  );
}

export function LiveBar() {
  const flow = useEditor((s) => s.flow)!;
  const live = useApp((s) => s.live);
  const [sessionOpen, setSessionOpen] = useState(false);
  if (live.mode === 'closed' || live.flowId !== flow.id) return null;
  const host = (() => {
    try {
      return live.url ? new URL(live.url).hostname : '';
    } catch {
      return '';
    }
  })();

  const recording = live.mode === 'recording' || live.mode === 'paused' || (live.mode === 'picking' && live.startedAt);
  return (
    <div className={cn('flex h-11 shrink-0 items-center gap-3 border-b px-4', recording ? 'border-rec/30 bg-rec-soft' : live.mode === 'playing' ? 'border-accent-line bg-accent-soft' : 'border-line bg-panel')} role="status">
      {live.mode === 'starting' && <span className="text-[13px] text-ink-2">Opening the browser…</span>}

      {recording && (
        <>
          <span className={cn('h-2.5 w-2.5 rounded-full', live.mode === 'paused' ? 'bg-warn' : 'rec-pulse bg-rec')} />
          <span className="text-[13px] font-semibold text-ink">{live.mode === 'paused' ? 'Recording paused' : live.mode === 'picking' ? 'Pick an element in the browser' : 'Recording'}</span>
          <span className="text-[12.5px] text-ink-2">
            <Timer since={live.startedAt} /> · {live.recordedCount} new step{live.recordedCount === 1 ? '' : 's'}
          </span>
          {host && <span className="truncate font-mono text-[11.5px] text-ink-3">{host}</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={Link2} onClick={() => void api.live.addAssertion('url')}>
              Check URL
            </Button>
            {live.mode === 'paused' ? (
              <Button size="sm" icon={Play} onClick={() => void api.live.resume()}>
                Resume
              </Button>
            ) : (
              <Button size="sm" icon={Pause} onClick={() => void api.live.pause()}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="rec" icon={Square} onClick={() => void stopRecording()}>
              Stop recording
            </Button>
          </div>
        </>
      )}

      {live.mode === 'playing' && (
        <>
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-[13px] font-semibold text-ink">{live.playback?.paused ? 'Paused' : 'Playing'}</span>
          {live.playback && (
            <span className="tnum text-[12.5px] text-ink-2">
              Step {live.playback.index + 1} of {flow.steps.length}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {live.playback?.paused ? (
              <>
                <Button size="sm" icon={StepForward} onClick={() => void api.live.playControl('step')}>
                  Next step
                </Button>
                <Button size="sm" variant="primary" icon={Play} onClick={() => void api.live.playControl('resume')}>
                  Continue
                </Button>
              </>
            ) : (
              <Button size="sm" icon={Pause} onClick={() => void api.live.playControl('pause')}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="danger" icon={Square} onClick={() => void api.live.playControl('stop')}>
              Stop
            </Button>
          </div>
        </>
      )}

      {(live.mode === 'idle' || (live.mode === 'picking' && !live.startedAt)) && (
        <>
          <Globe size={15} className="text-pass" />
          <span className="text-[13px] font-medium text-ink">{live.mode === 'picking' ? 'Click an element in the browser' : 'Browser open'}</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-3" title={live.url}>
            {live.title ? `${live.title} · ` : ''}
            {live.url}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setSessionOpen(true)}>
              Save login
            </Button>
            <Button
              size="sm"
              icon={undefined}
              onClick={() => {
                const sel = useEditor.getState().focusId;
                void recordInto(flow, { insertAfter: sel ?? 'end' });
              }}
            >
              <span className="h-2 w-2 rounded-full bg-rec" /> Record here
            </Button>
            <IconButton icon={X} label="Close the browser" onClick={() => void api.live.close()} />
          </div>
        </>
      )}
      <SaveSessionDialog open={sessionOpen} onOpenChange={setSessionOpen} defaultName={host ? `${host} login` : 'Saved login'} />
    </div>
  );
}
