import type {
  AppInfo,
  BrowserChoice,
  BrowserInfo,
  Dataset,
  DatasetSummary,
  Flow,
  FlowSummary,
  IterationResult,
  LogEntry,
  Run,
  RunOptions,
  RunSummary,
  RunTrigger,
  SavedSession,
  Schedule,
  Settings,
  Step,
  StepResult,
  StepStatus,
  Target,
} from './types';

// ── Live browser (recording, step debugging, element picking) ───────────────

export type LiveMode = 'closed' | 'starting' | 'idle' | 'recording' | 'paused' | 'picking' | 'playing';

export interface LiveState {
  mode: LiveMode;
  flowId?: string;
  browser?: BrowserChoice;
  startedAt?: number;
  recordedCount: number;
  url?: string;
  title?: string;
  tabs: number;
  playback?: { index: number; total: number; paused: boolean };
  error?: string;
}

export interface LiveStartOptions {
  flowId: string;
  url?: string;
  record: boolean;
  /** Add an "Open URL" step for `url` when recording starts. */
  addNavigateStep?: boolean;
  browser?: BrowserChoice;
  sessionId?: string;
  /** Replay these steps first, then start recording (record from here). */
  replay?: Step[];
  variables?: Record<string, string>;
}

export interface LivePlayOptions {
  steps: Step[];
  /** Inclusive index into `steps` where playback starts. */
  from: number;
  /** Inclusive index where playback stops. */
  to: number;
  variables: Record<string, string>;
  speed: number;
  pauseOnBreakpoints: boolean;
  dataLocale?: string;
}

export type LiveEvent =
  | { type: 'state'; state: LiveState }
  | { type: 'recorded'; op: 'add'; step: Step }
  | { type: 'recorded'; op: 'update'; step: Step }
  | { type: 'recorded'; op: 'remove'; id: string }
  | { type: 'stepStatus'; stepId: string; index: number; status: StepStatus; error?: string; duration?: number; message?: string; healed?: StepResult['healed']; value?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error' | 'success'; message: string }
  | { type: 'stopRequested' }
  | { type: 'picked'; target: Target | null }
  | { type: 'vars'; vars: Record<string, string> }
  | { type: 'healed'; stepId: string; target: Target };

export interface TargetTestResult {
  frameFound: boolean;
  candidates: { index: number; count: number; visible: boolean }[];
  bestIndex: number;
}

// ── Runs ───────────────────────────────────────────────────────────────────

export type RunEvent =
  | { type: 'run'; run: RunSummary }
  | { type: 'iteration'; runId: string; iteration: IterationResult }
  | { type: 'steps'; runId: string; items: { iteration: number; result: StepResult }[] }
  | { type: 'log'; runId: string; entries: LogEntry[] }
  | { type: 'removed'; runId: string };

export interface ExportResult {
  path?: string;
  canceled?: boolean;
  error?: string;
}

// ── Bridge ─────────────────────────────────────────────────────────────────

export interface XeroApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<void>;
    showInFolder(path: string): Promise<void>;
    detectBrowsers(): Promise<BrowserInfo[]>;
    installChromium(): Promise<{ ok: boolean; message: string }>;
    onInstallProgress(cb: (line: string) => void): () => void;
    chooseFiles(opts?: { multiple?: boolean; title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
    chooseExecutable(): Promise<string | null>;
    setTitleBarTheme(theme: 'dark' | 'light'): Promise<void>;
    onNavigate(cb: (route: string) => void): () => void;
    revealDataFolder(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
    onChange(cb: (s: Settings) => void): () => void;
  };
  flows: {
    list(): Promise<FlowSummary[]>;
    get(id: string): Promise<Flow | null>;
    save(flow: Flow): Promise<Flow>;
    create(patch?: Partial<Flow>): Promise<Flow>;
    delete(id: string): Promise<void>;
    duplicate(id: string): Promise<Flow | null>;
    importFiles(): Promise<Flow[]>;
    exportFile(id: string, format: 'json' | 'playwright'): Promise<ExportResult>;
    onChange(cb: (list: FlowSummary[]) => void): () => void;
  };
  live: {
    start(opts: LiveStartOptions): Promise<LiveState>;
    record(): Promise<LiveState>;
    pause(): Promise<LiveState>;
    resume(): Promise<LiveState>;
    stopRecording(): Promise<LiveState>;
    close(): Promise<void>;
    getState(): Promise<LiveState>;
    play(opts: LivePlayOptions): Promise<{ status: 'passed' | 'failed' | 'stopped'; vars: Record<string, string> }>;
    playControl(cmd: 'pause' | 'resume' | 'step' | 'stop'): Promise<void>;
    pick(): Promise<Target | null>;
    cancelPick(): Promise<void>;
    highlight(target: Target, tab?: number): Promise<TargetTestResult>;
    testTarget(target: Target, tab?: number): Promise<TargetTestResult>;
    saveSession(name: string): Promise<SavedSession | null>;
    forget(stepId: string): Promise<void>;
    addAssertion(kind: 'url' | 'title'): Promise<void>;
    onEvent(cb: (e: LiveEvent) => void): () => void;
  };
  runs: {
    start(flowId: string, options: Partial<RunOptions>, trigger?: RunTrigger): Promise<string>;
    stop(id: string): Promise<void>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    list(): Promise<RunSummary[]>;
    get(id: string): Promise<Run | null>;
    delete(id: string): Promise<void>;
    clear(): Promise<void>;
    peek(id: string, iteration?: number): Promise<string | null>;
    exportReport(id: string, format: 'html' | 'json' | 'csv'): Promise<ExportResult>;
    onEvent(cb: (e: RunEvent) => void): () => void;
  };
  datasets: {
    list(): Promise<DatasetSummary[]>;
    get(id: string): Promise<Dataset | null>;
    save(ds: Dataset): Promise<Dataset>;
    delete(id: string): Promise<void>;
    importFile(): Promise<Dataset | null>;
    exportCsv(id: string): Promise<ExportResult>;
    exportRows(name: string, columns: string[], rows: Record<string, string>[]): Promise<ExportResult>;
    onChange(cb: (list: DatasetSummary[]) => void): () => void;
  };
  schedules: {
    list(): Promise<Schedule[]>;
    save(s: Schedule): Promise<Schedule>;
    delete(id: string): Promise<void>;
    runNow(id: string): Promise<string | null>;
    onChange(cb: (list: Schedule[]) => void): () => void;
  };
  sessions: {
    list(): Promise<SavedSession[]>;
    rename(id: string, name: string): Promise<void>;
    delete(id: string): Promise<void>;
    onChange(cb: (list: SavedSession[]) => void): () => void;
  };
}

/** IPC channel names. Invoke channels are `ns:method`, events are `evt:ns`. */
export const EVENTS = {
  live: 'evt:live',
  runs: 'evt:runs',
  flows: 'evt:flows',
  settings: 'evt:settings',
  datasets: 'evt:datasets',
  schedules: 'evt:schedules',
  sessions: 'evt:sessions',
  navigate: 'evt:navigate',
  install: 'evt:install',
} as const;
