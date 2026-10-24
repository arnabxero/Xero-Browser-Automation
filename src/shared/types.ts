// Core domain model shared by the main process, the preload bridge, the renderer
// and the injected recorder. Keep this file free of runtime dependencies.

export type StepType =
  | 'navigate'
  | 'click'
  | 'hover'
  | 'fill'
  | 'press'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'upload'
  | 'dragDrop'
  | 'scroll'
  | 'wait'
  | 'waitFor'
  | 'assert'
  | 'extract'
  | 'setVariable'
  | 'screenshot'
  | 'script'
  | 'newTab'
  | 'closeTab'
  | 'goBack'
  | 'goForward'
  | 'reload'
  | 'dialog';

export type SelectorKind =
  | 'testid'
  | 'id'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'name'
  | 'alt'
  | 'title'
  | 'css'
  | 'xpath';

export interface SelectorCandidate {
  kind: SelectorKind;
  /** Selector value. For `role` this is the ARIA role, for `testid` the attribute value. */
  value: string;
  /** Accessible name for `role` selectors. */
  name?: string;
  /** Attribute name for `testid` selectors (data-testid, data-qa, ...). */
  attr?: string;
  /** Zero-based index when the selector matches several elements. */
  nth?: number;
  /** Robustness score, 0-100. Higher is tried first. */
  score: number;
  /** Number of elements this selector matched when it was generated. */
  matches?: number;
}

export interface ElementFingerprint {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
  classes?: string[];
  testId?: string;
  title?: string;
  alt?: string;
  value?: string;
}

export interface FrameRef {
  selector: string;
  name?: string;
  url?: string;
}

export interface Target {
  selectors: SelectorCandidate[];
  fingerprint: ElementFingerprint;
  /** Human readable description, e.g. `button "Sign in"`. */
  description: string;
  role?: string;
  framePath?: FrameRef[];
}

/** Everything we know about a form field. Used by the field-type classifier. */
export interface FieldInfo {
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  title?: string;
  nearbyText?: string;
  describedBy?: string;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  min?: string;
  max?: string;
  step?: string;
  inputMode?: string;
  required?: boolean;
  multiline?: boolean;
  contentEditable?: boolean;
  formName?: string;
  options?: { value: string; label: string }[];
  radioGroup?: string;
  className?: string;
}

export type ValueMode = 'static' | 'random' | 'template' | 'dataset' | 'variable';

export interface ValueSource {
  mode: ValueMode;
  static?: string;
  /** Data type id from the generator catalog (random mode). */
  dataType?: string;
  /** Generator options (random mode). */
  options?: Record<string, unknown>;
  template?: string;
  /** Dataset column (dataset mode). */
  column?: string;
  /** Variable name (variable mode). */
  variable?: string;
  /** Store the produced value into this variable for later steps. */
  saveAs?: string;
}

export interface FieldSuggestion {
  dataType: string;
  confidence: number;
  reasons: string[];
}

export type AssertKind =
  | 'text'
  | 'visible'
  | 'hidden'
  | 'value'
  | 'url'
  | 'title'
  | 'attribute'
  | 'checked'
  | 'enabled'
  | 'count';

export type CompareOp =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'greaterThan'
  | 'lessThan';

export type WaitKind = 'visible' | 'hidden' | 'attached' | 'detached' | 'url' | 'networkIdle' | 'load' | 'text';

export type ExtractSource = 'text' | 'value' | 'attribute' | 'html' | 'url' | 'title' | 'count';

export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface Step {
  id: string;
  type: StepType;
  enabled: boolean;
  /** Continue the iteration when this step fails. */
  optional?: boolean;
  /** Pause live playback before this step. */
  breakpoint?: boolean;
  /** Custom display label. */
  label?: string;
  note?: string;
  /** Index of the tab (in opening order) this step runs in. */
  tab?: number;
  target?: Target;
  url?: string;
  value?: ValueSource;
  key?: string;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: Modifier[];
  position?: { x: number; y: number };
  files?: string[];
  destination?: Target;
  scroll?: { x: number; y: number; mode: 'window' | 'element' };
  /** wait: milliseconds. */
  duration?: number;
  waitFor?: { kind: WaitKind; value?: string };
  assert?: { kind: AssertKind; op: CompareOp; expected?: string; attribute?: string; soft?: boolean };
  extract?: { source: ExtractSource; attribute?: string; regex?: string; variable: string };
  /** setVariable: variable name. */
  variable?: string;
  /** script: JavaScript evaluated in the page. */
  code?: string;
  /** script: store the returned value in this variable. */
  resultVariable?: string;
  screenshot?: { fullPage?: boolean; element?: boolean; name?: string };
  dialog?: { action: 'accept' | 'dismiss'; promptText?: string; message?: string; dialogType?: string };
  /** select: recorded option values and labels. */
  select?: { values: string[]; labels: string[] };
  /** check/uncheck on custom controls: click instead of setChecked. */
  useClick?: boolean;
  timeout?: number;
  retries?: number;
  /** Extra delay before running this step (ms, not scaled by speed). */
  delayBefore?: number;
  /** Milliseconds since the previous step at record time. */
  recordedDelay?: number;
  field?: FieldInfo;
  suggestions?: FieldSuggestion[];
  /** URL of the page when the step was recorded. */
  pageUrl?: string;
  createdAt?: number;
}

export interface FlowVariable {
  name: string;
  value: string;
  description?: string;
  secret?: boolean;
}

export type RunStatus = 'queued' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'error';
export type IterationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'stopped';
export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'warning';

export interface FlowLastRun {
  runId: string;
  status: RunStatus;
  at: number;
  passed: number;
  failed: number;
  total: number;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  favorite?: boolean;
  startUrl?: string;
  steps: Step[];
  variables: FlowVariable[];
  runDefaults?: Partial<RunOptions>;
  createdAt: number;
  updatedAt: number;
  lastRun?: FlowLastRun;
  runCount?: number;
  schemaVersion: 1;
}

export interface FlowSummary extends Omit<Flow, 'steps' | 'variables'> {
  stepCount: number;
  fieldCount: number;
  randomFieldCount: number;
  domain?: string;
}

export type BrowserChoice = 'msedge' | 'chrome' | 'brave' | 'chromium' | 'custom';

export type ScreenshotPolicy = 'none' | 'failure' | 'end' | 'step';

export interface RunOptions {
  iterations: number;
  concurrency: number;
  /** Speed multiplier. 0 means "max" (no artificial delays). */
  speed: number;
  /** Base pause between steps at 1x speed (ms). */
  stepDelay: number;
  useRecordedTiming: boolean;
  /** Add random jitter to delays and keystrokes. */
  humanize: boolean;
  typingMode: 'fill' | 'type';
  /** Delay per keystroke at 1x speed when typingMode is "type" (ms). */
  typingDelay: number;
  headless: boolean;
  browser: BrowserChoice;
  stopOnFailure: boolean;
  iterationRetries: number;
  stepRetries: number;
  stepTimeout: number;
  navigationTimeout: number;
  delayBetweenIterations: number;
  screenshots: ScreenshotPolicy;
  isolation: 'fresh' | 'reuse';
  datasetId?: string;
  datasetMode: 'sequential' | 'random';
  sessionId?: string;
  viewport?: { width: number; height: number } | null;
  userAgent?: string;
  browserLocale?: string;
  timezone?: string;
  dataLocale: string;
  proxies: string[];
  proxyMode: 'none' | 'rotate' | 'random';
  blockResources: ('image' | 'font' | 'media')[];
  autoHeal: boolean;
  saveHealedSelectors: boolean;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export interface StepResult {
  stepId: string;
  index: number;
  status: StepStatus;
  startedAt: number;
  duration: number;
  error?: string;
  message?: string;
  healed?: { kind: SelectorKind; value: string; name?: string };
  usedSelector?: string;
  screenshot?: string;
  value?: string;
  attempts?: number;
}

export interface IterationResult {
  index: number;
  status: IterationStatus;
  startedAt?: number;
  endedAt?: number;
  duration?: number;
  attempt: number;
  worker?: number;
  error?: string;
  failedStep?: number;
  steps: StepResult[];
  /** Values typed or chosen, keyed by field label. */
  data: Record<string, string>;
  variables: Record<string, string>;
  screenshot?: string;
  proxy?: string;
  datasetRow?: number;
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  stopped: number;
  running: number;
  pending: number;
}

export interface LogEntry {
  t: number;
  level: 'debug' | 'info' | 'success' | 'warn' | 'error';
  msg: string;
  iteration?: number;
  step?: number;
}

export type RunTrigger = 'manual' | 'schedule' | 'api';

export interface Run {
  id: string;
  flowId: string;
  flowName: string;
  status: RunStatus;
  trigger: RunTrigger;
  scheduleId?: string;
  options: RunOptions;
  startedAt: number;
  endedAt?: number;
  duration?: number;
  totals: RunTotals;
  iterations: IterationResult[];
  logs: LogEntry[];
  steps: Step[];
  error?: string;
  healedCount?: number;
}

export interface RunSummary extends Omit<Run, 'iterations' | 'logs' | 'steps'> {
  stepCount: number;
  avgDuration?: number;
}

export interface Dataset {
  id: string;
  name: string;
  columns: string[];
  rows: Record<string, string>[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface DatasetSummary extends Omit<Dataset, 'rows'> {
  rowCount: number;
}

export type ScheduleKind = 'interval' | 'daily' | 'weekly' | 'cron' | 'once';

export interface Schedule {
  id: string;
  flowId: string;
  name?: string;
  enabled: boolean;
  kind: ScheduleKind;
  everyMinutes?: number;
  time?: string;
  days?: number[];
  cron?: string;
  at?: number;
  options?: Partial<RunOptions>;
  createdAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastStatus?: RunStatus;
  nextRunAt?: number;
}

export interface SavedSession {
  id: string;
  name: string;
  origins: string[];
  cookieCount: number;
  createdAt: number;
}

export interface RecorderSettings {
  recordScroll: boolean;
  recordTab: boolean;
  showToolbar: boolean;
  highlightRecorded: boolean;
  dialogs: 'ask' | 'accept' | 'dismiss';
  autoRandomize: boolean;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  browser: BrowserChoice;
  customBrowserPath?: string;
  dataLocale: string;
  emailDomain?: string;
  maskSecrets: boolean;
  recorder: RecorderSettings;
  runDefaults: RunOptions;
  closeToTray: boolean;
  launchAtLogin: boolean;
  notifications: boolean;
  sidebarCollapsed: boolean;
  hideAutomationBanner: boolean;
  keepRuns: number;
  onboardingDone: boolean;
}

export interface BrowserInfo {
  id: BrowserChoice;
  name: string;
  available: boolean;
  path?: string;
  note?: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  playwright: string;
  dataDir: string;
  platform: string;
  playgroundUrl: string;
}
