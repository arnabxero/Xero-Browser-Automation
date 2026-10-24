import type { Flow, RunOptions, Settings, Step, StepType } from './types';

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  iterations: 1,
  concurrency: 1,
  speed: 1,
  stepDelay: 250,
  useRecordedTiming: false,
  humanize: false,
  typingMode: 'fill',
  typingDelay: 70,
  headless: false,
  browser: 'msedge',
  stopOnFailure: false,
  iterationRetries: 0,
  stepRetries: 1,
  stepTimeout: 15000,
  navigationTimeout: 30000,
  delayBetweenIterations: 0,
  screenshots: 'failure',
  isolation: 'fresh',
  datasetMode: 'sequential',
  viewport: null,
  dataLocale: 'en_US',
  proxies: [],
  proxyMode: 'none',
  blockResources: [],
  autoHeal: true,
  saveHealedSelectors: false,
  waitUntil: 'load',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  browser: 'msedge',
  dataLocale: 'en_US',
  maskSecrets: true,
  recorder: {
    recordScroll: false,
    recordTab: false,
    showToolbar: true,
    highlightRecorded: true,
    dialogs: 'ask',
    autoRandomize: false,
  },
  runDefaults: DEFAULT_RUN_OPTIONS,
  closeToTray: true,
  launchAtLogin: false,
  notifications: true,
  sidebarCollapsed: false,
  hideAutomationBanner: true,
  keepRuns: 200,
  onboardingDone: false,
};

export const SPEED_PRESETS: { value: number; label: string; hint: string }[] = [
  { value: 0.25, label: '0.25×', hint: 'Slow motion' },
  { value: 0.5, label: '0.5×', hint: 'Relaxed' },
  { value: 1, label: '1×', hint: 'Normal' },
  { value: 2, label: '2×', hint: 'Fast' },
  { value: 4, label: '4×', hint: 'Very fast' },
  { value: 0, label: 'Max', hint: 'No added delays' },
];

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}${time}${rand}`;
}

export function newStep(type: StepType, patch: Partial<Step> = {}): Step {
  const base: Step = { id: uid('s'), type, enabled: true, createdAt: Date.now() };
  switch (type) {
    case 'navigate':
      base.url = 'https://';
      break;
    case 'wait':
      base.duration = 1000;
      break;
    case 'waitFor':
      base.waitFor = { kind: 'visible' };
      break;
    case 'assert':
      base.assert = { kind: 'text', op: 'contains', expected: '' };
      break;
    case 'extract':
      base.extract = { source: 'text', variable: 'value' };
      break;
    case 'setVariable':
      base.variable = 'myVar';
      base.value = { mode: 'template', template: '' };
      break;
    case 'script':
      base.code = '// Runs in the page. Return a value to store it.\nreturn document.title;';
      break;
    case 'press':
      base.key = 'Enter';
      break;
    case 'fill':
      base.value = { mode: 'static', static: '' };
      break;
    case 'screenshot':
      base.screenshot = { fullPage: false };
      break;
    case 'newTab':
      base.url = 'about:blank';
      break;
    case 'dialog':
      base.dialog = { action: 'accept' };
      break;
    case 'scroll':
      base.scroll = { x: 0, y: 600, mode: 'window' };
      break;
  }
  return { ...base, ...patch };
}

export function newFlow(patch: Partial<Flow> = {}): Flow {
  const now = Date.now();
  return {
    id: uid('f'),
    name: 'Untitled flow',
    tags: [],
    steps: [],
    variables: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    ...patch,
  };
}

export function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'Local file';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/^(https?|file|about|data|chrome|edge):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  return `https://${s}`;
}

export function mergeRunOptions(...parts: (Partial<RunOptions> | undefined)[]): RunOptions {
  const out: RunOptions = { ...DEFAULT_RUN_OPTIONS };
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
