const pad = (n: number, len = 2) => String(n).padStart(len, '0');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Formats a date with a small token language:
 * YYYY YY MMMM MMM MM M DD D HH H hh mm ss A
 */
export function formatDate(d: Date, fmt = 'YYYY-MM-DD'): string {
  if (fmt === 'ISO') return d.toISOString();
  if (fmt === 'unix') return String(Math.floor(d.getTime() / 1000));
  if (fmt === 'unixms') return String(d.getTime());
  const h12 = d.getHours() % 12 || 12;
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(h12),
    h: String(h12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|ss|A/g, (t) => tokens[t] ?? t);
}

export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** Date format forced by native date-ish input types. */
export function nativeDateFormat(inputType?: string): string | undefined {
  switch (inputType) {
    case 'date':
      return 'YYYY-MM-DD';
    case 'datetime-local':
      return 'YYYY-MM-DDTHH:mm';
    case 'time':
      return 'HH:mm';
    case 'month':
      return 'YYYY-MM';
    default:
      return undefined;
  }
}

export function slugify(s: string, sep = '-'): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
}

export function camelVar(s: string): string {
  const words = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (!words.length) return 'value';
  const out = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[0-9]/.test(out) ? `v${out}` : out;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${pad(rs)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad(m % 60)}m`;
}

export function relativeTime(t?: number, now = Date.now()): string {
  if (!t) return 'never';
  const diff = t - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const fmt = (n: number, unit: string) => {
    const v = Math.round(n);
    const label = `${v} ${unit}${v === 1 ? '' : 's'}`;
    return future ? `in ${label}` : `${label} ago`;
  };
  if (abs < 45_000) return future ? 'in a moment' : 'just now';
  if (abs < 3_600_000) return fmt(abs / 60_000, 'minute');
  if (abs < 86_400_000) return fmt(abs / 3_600_000, 'hour');
  if (abs < 7 * 86_400_000) return fmt(abs / 86_400_000, 'day');
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
