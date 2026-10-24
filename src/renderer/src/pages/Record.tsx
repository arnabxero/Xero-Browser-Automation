import { Crosshair, Keyboard, MousePointerClick, ShieldCheck, Upload } from 'lucide-react';
import { RecordBar } from '@/components/RecordBar';
import { useRoute } from '@/lib/router';

const TIPS = [
  { icon: MousePointerClick, title: 'Use the site normally', body: 'Clicks, typing, dropdowns, checkboxes, keyboard shortcuts, drag and drop, new tabs and iframes are all captured.' },
  { icon: Crosshair, title: 'Add checks while you go', body: 'Use Check in the floating toolbar to verify text, values or the page URL. Runs fail when a check fails.' },
  { icon: Keyboard, title: 'Typed values stay editable', body: 'Every field is matched to a data type, so you can switch it to generated names, emails, cards or addresses afterwards.' },
  { icon: Upload, title: 'Files and dialogs too', body: 'File pickers open here so you can choose files, and confirm or prompt dialogs are answered and replayed.' },
  { icon: ShieldCheck, title: 'Stay logged in', body: 'After recording, save the browser’s login so later runs start signed in without repeating the sign-in steps.' },
];

export function RecordPage() {
  const { query } = useRoute();
  const url = query.get('url') ?? '';
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-8 pt-12 pb-12">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">New recording</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-2">A browser window opens with a recording toolbar at the top. Press Stop on the toolbar when you are done.</p>
        <div className="mt-6">
          <RecordBar key={url} initialUrl={url} autoFocus showName />
        </div>
        <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6">
          {TIPS.map((t) => (
            <div key={t.title} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-ink-2">
                <t.icon size={16} />
              </div>
              <div>
                <h3 className="text-[13.5px] font-semibold text-ink">{t.title}</h3>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
