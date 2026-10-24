import type { Browser, BrowserContext, Dialog, FileChooser, Frame, Page, Request } from 'playwright-core';
import type { LiveEvent, LivePlayOptions, LiveStartOptions, LiveState, TargetTestResult } from '../shared/api';
import { createGeneratorScope } from '../shared/data/catalog';
import { detectFieldType } from '../shared/data/detect';
import { mergeRunOptions, newStep } from '../shared/defaults';
import type { FieldInfo, FieldSuggestion, FrameRef, SavedSession, Settings, Step, StepType, Target, ValueSource } from '../shared/types';
import type { PageMessage, PageState, RecorderMode } from '../injected/protocol';
import { launchBrowser } from './browsers';
import { cleanError, Executor } from './engine/executor';
import { candidateLocator, describeHandle, framePathOf, resolveFrame, resolveTarget } from './engine/locate';
import { RECORDER_SOURCE } from './recorderSource';

export interface LiveHooks {
  emit(e: LiveEvent): void;
  settings(): Settings;
  chooseFiles(multiple: boolean): Promise<string[]>;
  askDialog(info: { type: string; message: string; defaultValue: string }): Promise<{ accept: boolean; promptText?: string }>;
  sessionFile(id: string): string | undefined;
  saveSession(name: string, state: Awaited<ReturnType<BrowserContext['storageState']>>): SavedSession;
  /** Tests only: run the live browser without a window, optionally reachable over CDP. */
  headless?: boolean;
  debugPort?: number;
}

type BindingSource = { context: BrowserContext; page: Page; frame: Frame };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sameTarget(a?: Target, b?: Target): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const x = a.selectors[0];
  const y = b.selectors[0];
  if (!x || !y) return a.description === b.description;
  const fa = (a.framePath ?? []).map((f) => f.selector).join('|');
  const fb = (b.framePath ?? []).map((f) => f.selector).join('|');
  return x.kind === y.kind && x.value === y.value && x.name === y.name && x.nth === y.nth && fa === fb;
}

export class LiveSession {
  private browser?: Browser;
  private context?: BrowserContext;
  readonly pages: Page[] = [];
  private st: LiveState = { mode: 'closed', recordedCount: 0, tabs: 0 };
  private buffer: Step[] = [];
  private textEntryClicks = new Set<string>();
  private recorderMode: RecorderMode = 'idle';
  private lastActionAt = 0;
  private ourNavUntil = 0;
  private userNav = new WeakMap<Page, boolean>();
  private lastUrl = new WeakMap<Page, string>();
  private pickResolve?: (t: Target | null) => void;
  private modeBeforePick: LiveState['mode'] = 'idle';
  private exec?: Executor;
  private playCtl?: { paused: boolean; stepOnce: boolean; stop: boolean };
  private framePaths = new WeakMap<Frame, Promise<FrameRef[]>>();
  private closing = false;
  private queue: Promise<unknown> = Promise.resolve();
  private activeTab = 0;

  constructor(private hooks: LiveHooks) {}

  // ── State ──────────────────────────────────────────────────────────────
  state(): LiveState {
    return { ...this.st, tabs: this.openPages().length };
  }

  private set(patch: Partial<LiveState>) {
    this.st = { ...this.st, ...patch };
    this.hooks.emit({ type: 'state', state: this.state() });
  }

  private notice(level: 'info' | 'warn' | 'error' | 'success', message: string) {
    this.hooks.emit({ type: 'notice', level, message });
  }

  isOpen(): boolean {
    return !!this.browser && this.browser.isConnected() && this.st.mode !== 'closed';
  }

  private isRecording(): boolean {
    return this.st.mode === 'recording' || (this.st.mode === 'picking' && this.modeBeforePick === 'recording');
  }

  private openPages(): Page[] {
    return this.pages.filter((p) => !p.isClosed());
  }

  private activePage(): Page | undefined {
    const p = this.pages[this.activeTab];
    if (p && !p.isClosed()) return p;
    const open = this.openPages();
    return open[open.length - 1];
  }

  private enqueue(fn: () => Promise<unknown> | unknown) {
    this.queue = this.queue.then(fn).catch((e) => this.notice('error', cleanError(e)));
    return this.queue;
  }

  private pageState(): PageState {
    const s = this.hooks.settings().recorder;
    return {
      recording: this.isRecording() || this.st.mode === 'paused' || (this.st.mode === 'picking' && this.modeBeforePick === 'paused'),
      paused: this.st.mode === 'paused',
      mode: this.recorderMode,
      toolbar: s.showToolbar,
      recordScroll: s.recordScroll,
      recordTab: s.recordTab,
      highlight: s.highlightRecorded,
      startedAt: this.st.startedAt,
      count: this.buffer.length,
    };
  }

  private async broadcast() {
    const s = this.pageState();
    await Promise.all(
      this.openPages().flatMap((p) =>
        p.frames().map((f) => f.evaluate((st) => window.__xero?.setState(st as never), s).catch(() => undefined)),
      ),
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  async start(opts: LiveStartOptions): Promise<LiveState> {
    if (this.isOpen() && this.st.flowId === opts.flowId && !opts.replay?.length) {
      const page = this.activePage();
      if (opts.record) await this.record();
      if (opts.url && page) {
        if (opts.record && opts.addNavigateStep) this.addStep(newStep('navigate', { url: opts.url, tab: this.pages.indexOf(page) }));
        await this.navigate(page, opts.url);
      }
      await page?.bringToFront().catch(() => undefined);
      return this.state();
    }
    await this.close();
    const settings = this.hooks.settings();
    this.set({ mode: 'starting', flowId: opts.flowId, recordedCount: 0, startedAt: undefined, error: undefined, playback: undefined, url: undefined, title: undefined });
    try {
      const { browser, resolved } = await launchBrowser({
        choice: opts.browser ?? settings.browser,
        customPath: settings.customBrowserPath,
        headless: this.hooks.headless ?? false,
        hideBanner: settings.hideAutomationBanner,
        windowSize: { width: 1400, height: 920 },
        extraArgs: this.hooks.debugPort ? [`--remote-debugging-port=${this.hooks.debugPort}`] : undefined,
      });
      if (resolved.fellBack) this.notice('warn', `The selected browser is not installed, so ${resolved.name} was opened instead.`);
      this.browser = browser;
      browser.on('disconnected', () => this.onDisconnected());
      const storageState = opts.sessionId ? this.hooks.sessionFile(opts.sessionId) : undefined;
      const context = await browser.newContext({ viewport: null, storageState, acceptDownloads: true });
      this.context = context;
      await context.exposeBinding('__xeroEmit', (source: BindingSource, msg: PageMessage) => this.onMessage(source, msg));
      await context.addInitScript({ content: RECORDER_SOURCE });
      context.on('page', (p) => this.attachPage(p));
      const page = await context.newPage();
      this.attachPage(page);
      this.set({ mode: 'idle', browser: resolved.choice });

      if (opts.replay?.length) {
        this.notice('info', `Replaying ${opts.replay.length} step${opts.replay.length === 1 ? '' : 's'} before recording…`);
        const res = await this.play({ steps: opts.replay, from: 0, to: opts.replay.length - 1, variables: opts.variables ?? {}, speed: 0, pauseOnBreakpoints: false });
        if (res.status !== 'passed') this.notice('warn', 'Replay stopped early. Recording continues from the current page.');
      }
      if (opts.record) await this.record();
      if (opts.url) {
        if (opts.record && opts.addNavigateStep) this.addStep(newStep('navigate', { url: opts.url, tab: 0 }));
        await this.navigate(page, opts.url);
      }
    } catch (e) {
      const message = cleanError(e);
      await this.close();
      this.set({ mode: 'closed', error: message });
      throw new Error(message);
    }
    return this.state();
  }

  private async navigate(page: Page, url: string) {
    this.ourNavUntil = Date.now() + 120_000;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (e) {
      this.notice('warn', `The page did not finish loading: ${cleanError(e)}`);
    } finally {
      this.ourNavUntil = Date.now() + 1500;
      this.lastUrl.set(page, page.url());
      this.refreshInfo(page);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.pickResolve?.(null);
    if (this.playCtl) this.playCtl.stop = true;
    const b = this.browser;
    this.browser = undefined;
    this.context = undefined;
    this.pages.length = 0;
    this.buffer = [];
    if (b) await b.close().catch(() => undefined);
    this.closing = false;
    if (this.st.mode !== 'closed') this.set({ mode: 'closed', playback: undefined, startedAt: undefined, recordedCount: 0 });
  }

  private onDisconnected() {
    if (this.closing) return;
    const wasRecording = this.isRecording() || this.st.mode === 'paused';
    this.browser = undefined;
    this.context = undefined;
    this.pages.length = 0;
    this.pickResolve?.(null);
    if (this.playCtl) this.playCtl.stop = true;
    this.set({ mode: 'closed', playback: undefined });
    if (wasRecording) this.notice('info', 'The browser was closed, so recording stopped.');
  }

  private attachPage(p: Page) {
    if (this.pages.includes(p)) return;
    this.pages.push(p);
    const tab = this.pages.length - 1;
    p.on('close', () => this.onPageClose(p));
    p.on('dialog', (d) => this.onDialog(p, d));
    p.on('filechooser', (fc) => this.onFileChooser(p, fc));
    p.on('request', (r) => this.onRequest(p, r));
    p.on('framenavigated', (f) => this.onFrameNavigated(p, f));
    p.on('load', () => this.refreshInfo(p));
    this.set({ tabs: this.openPages().length });
    if (tab > 0) {
      this.activeTab = tab;
      if (this.isRecording()) {
        const createdAt = Date.now();
        void p.opener().then((opener) => {
          if (!opener && createdAt - this.lastActionAt > 800 && this.isRecording()) this.addStep(newStep('newTab', { url: 'about:blank', tab }));
        });
      }
    }
  }

  private refreshInfo(p: Page) {
    if (p !== this.activePage() || p.isClosed()) return;
    const url = p.url();
    void p
      .title()
      .then((title) => this.set({ url, title }))
      .catch(() => this.set({ url }));
  }

  private onPageClose(p: Page) {
    if (this.closing) return;
    const tab = this.pages.indexOf(p);
    if (this.isRecording() && tab >= 0) this.addStep(newStep('closeTab', { tab }));
    this.set({ tabs: this.openPages().length });
    if (!this.openPages().length && this.browser) void this.close();
    else {
      const ap = this.activePage();
      if (ap) {
        this.activeTab = this.pages.indexOf(ap);
        this.refreshInfo(ap);
      }
    }
  }

  private onRequest(p: Page, req: Request) {
    if (!this.isRecording()) return;
    try {
      if (!req.isNavigationRequest() || req.frame() !== p.mainFrame() || req.redirectedFrom()) return;
    } catch {
      return;
    }
    if (Date.now() < this.ourNavUntil) return;
    this.userNav.set(p, Date.now() - this.lastActionAt > 1500);
  }

  private onFrameNavigated(p: Page, f: Frame) {
    if (f !== p.mainFrame()) return;
    const prev = this.lastUrl.get(p);
    const url = f.url();
    this.lastUrl.set(p, url);
    this.refreshInfo(p);
    if (!this.isRecording() || !this.userNav.get(p)) return;
    this.userNav.set(p, false);
    if (!url || url === 'about:blank' || /^(chrome|edge)-error:/.test(url)) return;
    const tab = this.pages.indexOf(p);
    this.enqueue(() => {
      const last = this.buffer[this.buffer.length - 1];
      if (last?.type === 'navigate' && (last.tab ?? 0) === tab && Date.now() - (last.createdAt ?? 0) < 3000) {
        last.url = url;
        this.updateStep(last);
      } else if (prev === url) this.addStep(newStep('reload', { tab }));
      else this.addStep(newStep('navigate', { url, tab, recordedDelay: Date.now() - this.lastActionAt }));
    });
  }

  private onDialog(p: Page, d: Dialog) {
    if (this.st.mode === 'playing' && this.exec) {
      void this.exec.handleDialog(d);
      return;
    }
    const tab = this.pages.indexOf(p);
    void this.enqueue(async () => {
      const policy = this.hooks.settings().recorder.dialogs;
      let accept = policy !== 'dismiss';
      let promptText = d.defaultValue();
      if (policy === 'ask' && d.type() !== 'beforeunload') {
        const r = await this.hooks.askDialog({ type: d.type(), message: d.message(), defaultValue: d.defaultValue() });
        accept = r.accept;
        if (r.promptText !== undefined) promptText = r.promptText;
      }
      if ((this.isRecording() || this.st.mode === 'paused') && d.type() !== 'beforeunload' && this.st.mode !== 'paused') {
        this.addStep(
          newStep('dialog', {
            tab,
            dialog: { action: accept ? 'accept' : 'dismiss', promptText: d.type() === 'prompt' ? promptText : undefined, message: d.message().slice(0, 240), dialogType: d.type() },
          }),
        );
      }
      try {
        if (accept) await d.accept(promptText);
        else await d.dismiss();
      } catch {
        /* already handled */
      }
    });
  }

  private onFileChooser(p: Page, fc: FileChooser) {
    if (this.st.mode === 'playing' && this.exec) {
      void this.exec.handleFileChooser(fc);
      return;
    }
    const tab = this.pages.indexOf(p);
    void this.enqueue(async () => {
      const files = await this.hooks.chooseFiles(fc.isMultiple());
      try {
        await fc.setFiles(files);
      } catch (e) {
        this.notice('error', `Could not attach files: ${cleanError(e)}`);
        return;
      }
      if (!files.length || !this.isRecording()) return;
      const handle = fc.element();
      const target = await describeHandle(handle, RECORDER_SOURCE);
      const frame = await handle.ownerFrame();
      if (!target) return;
      const fp = frame ? await this.framePath(frame) : [];
      this.addStep(newStep('upload', { tab, target: { ...target, framePath: fp.length ? fp : undefined }, files }));
    });
  }

  private framePath(frame: Frame): Promise<FrameRef[]> {
    if (!frame.parentFrame()) return Promise.resolve([]);
    let p = this.framePaths.get(frame);
    if (!p) {
      p = framePathOf(frame, RECORDER_SOURCE).catch(() => []);
      this.framePaths.set(frame, p);
    }
    return p;
  }

  // ── Messages from the injected recorder ───────────────────────────────
  private onMessage(source: BindingSource, msg: PageMessage): unknown {
    switch (msg.t) {
      case 'hello':
        return this.pageState();
      case 'action':
        void this.enqueue(() => this.onAction(source, msg));
        return undefined;
      case 'cmd':
        void this.enqueue(() => this.onCmd(source, msg));
        return undefined;
      case 'picked':
        void this.enqueue(async () => {
          const fp = await this.framePath(source.frame);
          this.pickResolve?.({ ...msg.target, framePath: fp.length ? fp : undefined });
        });
        return undefined;
    }
    return undefined;
  }

  private async onCmd(source: BindingSource, msg: Extract<PageMessage, { t: 'cmd' }>) {
    const tab = Math.max(0, this.pages.indexOf(source.page));
    switch (msg.cmd) {
      case 'pause':
        await this.pause();
        break;
      case 'resume':
        await this.resume();
        break;
      case 'stop':
        this.hooks.emit({ type: 'stopRequested' });
        break;
      case 'addWait':
        this.addStep(newStep('wait', { duration: 1000, tab }));
        break;
      case 'screenshot':
        this.addStep(newStep('screenshot', { screenshot: { fullPage: false }, tab }));
        break;
      case 'assertUrl':
        this.addStep(newStep('assert', { tab, assert: { kind: 'url', op: 'equals', expected: source.page.url() } }));
        break;
      case 'assertTitle':
        this.addStep(newStep('assert', { tab, assert: { kind: 'title', op: 'equals', expected: await source.page.title() } }));
        break;
      case 'cancelPick':
        if (this.recorderMode === 'pick') this.pickResolve?.(null);
        else {
          this.recorderMode = this.isRecording() ? 'record' : 'idle';
          await this.broadcast();
        }
        break;
      case 'setMode':
        if (msg.mode) {
          this.recorderMode = msg.mode;
          await this.broadcast();
        }
        break;
    }
  }

  private autoValue(suggestions: FieldSuggestion[], recorded: string): ValueSource {
    const top = suggestions[0];
    if (this.hooks.settings().recorder.autoRandomize && top && top.confidence >= 0.6) return { mode: 'random', dataType: top.dataType, static: recorded };
    return { mode: 'static', static: recorded };
  }

  private uniqueVar(name: string): string {
    const used = new Set(this.buffer.filter((s) => s.type === 'extract').map((s) => s.extract?.variable));
    if (!used.has(name)) return name;
    let i = 2;
    while (used.has(`${name}${i}`)) i++;
    return `${name}${i}`;
  }

  private async onAction(source: BindingSource, msg: Extract<PageMessage, { t: 'action' }>) {
    if (!this.isRecording()) return;
    const a = msg.a;
    const tab = Math.max(0, this.pages.indexOf(source.page));
    this.activeTab = tab;
    const fp = await this.framePath(source.frame);
    const withFrame = (t?: Target): Target | undefined => (t ? { ...t, framePath: fp.length ? fp : undefined } : undefined);
    const target = withFrame('target' in a ? a.target : undefined);
    const now = Date.now();
    const delay = this.lastActionAt ? Math.min(now - this.lastActionAt, 60_000) : 0;
    const last = this.buffer[this.buffer.length - 1];
    const sameAsLast = (types: StepType[]) => !!last && types.includes(last.type) && (last.tab ?? 0) === tab && sameTarget(last.target, target);
    const base = { tab, pageUrl: msg.url, recordedDelay: delay };

    switch (a.kind) {
      case 'click': {
        if (a.clickCount >= 2 && sameAsLast(['click'])) {
          last!.clickCount = a.clickCount;
          this.updateStep(last!);
          return;
        }
        const step = newStep('click', {
          ...base,
          target,
          button: a.button !== 'left' ? a.button : undefined,
          clickCount: a.clickCount > 1 ? a.clickCount : undefined,
          modifiers: a.modifiers.length ? a.modifiers : undefined,
          position: a.position,
        });
        if (a.textEntry) this.textEntryClicks.add(step.id);
        this.addStep(step);
        return;
      }
      case 'fill': {
        if (sameAsLast(['fill'])) {
          const v = last!.value ?? { mode: 'static' };
          last!.value = { ...v, static: a.value };
          last!.field = a.field;
          last!.suggestions = detectFieldType(a.field, a.value);
          if (v.mode === 'static' && this.hooks.settings().recorder.autoRandomize) last!.value = { ...this.autoValue(last!.suggestions, a.value), saveAs: v.saveAs };
          this.updateStep(last!);
          return;
        }
        if (last?.type === 'click' && this.textEntryClicks.has(last.id) && sameTarget(last.target, target)) this.removeStep(last.id);
        const suggestions = detectFieldType(a.field, a.value);
        this.addStep(newStep('fill', { ...base, target, value: this.autoValue(suggestions, a.value), field: a.field, suggestions }));
        return;
      }
      case 'select': {
        if (sameAsLast(['select'])) {
          last!.select = { values: a.values, labels: a.labels };
          last!.value = { ...(last!.value ?? { mode: 'static' }), static: a.values[0] ?? '' };
          this.updateStep(last!);
          return;
        }
        const suggestions = detectFieldType(a.field, a.labels[0]);
        const auto = this.autoValue(suggestions, a.values[0] ?? '');
        this.addStep(newStep('select', { ...base, target, select: { values: a.values, labels: a.labels }, value: auto, field: a.field, suggestions }));
        return;
      }
      case 'check':
      case 'uncheck': {
        if (sameAsLast(['check', 'uncheck'])) {
          last!.type = a.kind;
          this.updateStep(last!);
          return;
        }
        if (last?.type === 'click' && sameTarget(last.target, target) && delay < 400) this.removeStep(last.id);
        const suggestions = detectFieldType(a.field as FieldInfo);
        this.addStep(newStep(a.kind, { ...base, target, field: a.field, suggestions }));
        return;
      }
      case 'press':
        this.addStep(newStep('press', { ...base, target, key: a.key }));
        return;
      case 'hover':
        this.addStep(newStep('hover', { ...base, target }));
        return;
      case 'dragDrop':
        if (last?.type === 'click' && sameTarget(last.target, target) && delay < 400) this.removeStep(last.id);
        this.addStep(newStep('dragDrop', { ...base, target, destination: withFrame(a.destination) }));
        return;
      case 'scroll': {
        if (last?.type === 'scroll' && (last.tab ?? 0) === tab && sameTarget(last.target, target)) {
          last.scroll = { x: a.x, y: a.y, mode: target ? 'element' : 'window' };
          this.updateStep(last);
          return;
        }
        this.addStep(newStep('scroll', { ...base, target, scroll: { x: a.x, y: a.y, mode: target ? 'element' : 'window' } }));
        return;
      }
      case 'assert':
        this.addStep(newStep('assert', { ...base, target, assert: { ...a.assert } }));
        return;
      case 'extract':
        this.addStep(newStep('extract', { ...base, target, extract: { source: a.source, variable: this.uniqueVar(a.variable) } }));
        return;
    }
  }

  private countTimer?: NodeJS.Timeout;
  /** Keeps the toolbar's step counter in sync with the merged step list. */
  private pushCount() {
    if (this.countTimer) return;
    this.countTimer = setTimeout(() => {
      this.countTimer = undefined;
      const count = this.buffer.length;
      for (const p of this.openPages()) void p.mainFrame().evaluate((c) => window.__xero?.setState({ count: c }), count).catch(() => undefined);
    }, 120);
  }

  private addStep(step: Step) {
    this.buffer.push(step);
    this.pushCount();
    this.lastActionAt = Date.now();
    this.st.recordedCount = this.buffer.length;
    this.hooks.emit({ type: 'recorded', op: 'add', step });
    this.hooks.emit({ type: 'state', state: this.state() });
  }

  private updateStep(step: Step) {
    this.lastActionAt = Date.now();
    this.hooks.emit({ type: 'recorded', op: 'update', step: { ...step } });
  }

  private removeStep(id: string) {
    this.buffer = this.buffer.filter((s) => s.id !== id);
    this.pushCount();
    this.textEntryClicks.delete(id);
    this.st.recordedCount = this.buffer.length;
    this.hooks.emit({ type: 'recorded', op: 'remove', id });
  }

  forget(id: string) {
    this.buffer = this.buffer.filter((s) => s.id !== id);
    this.pushCount();
    this.st.recordedCount = this.buffer.length;
  }

  // ── Recording controls ────────────────────────────────────────────────
  async record(): Promise<LiveState> {
    if (!this.isOpen()) throw new Error('The live browser is not open');
    this.buffer = [];
    this.textEntryClicks.clear();
    this.recorderMode = 'record';
    this.lastActionAt = Date.now();
    this.set({ mode: 'recording', startedAt: Date.now(), recordedCount: 0, playback: undefined });
    await this.broadcast();
    await this.activePage()?.bringToFront().catch(() => undefined);
    return this.state();
  }

  async pause(): Promise<LiveState> {
    if (this.st.mode === 'recording') {
      this.set({ mode: 'paused' });
      await this.broadcast();
    }
    return this.state();
  }

  async resume(): Promise<LiveState> {
    if (this.st.mode === 'paused') {
      this.recorderMode = 'record';
      this.set({ mode: 'recording' });
      await this.broadcast();
    }
    return this.state();
  }

  async stopRecording(): Promise<LiveState> {
    await this.queue.catch(() => undefined);
    if (this.st.mode === 'picking') this.pickResolve?.(null);
    if (this.st.mode === 'recording' || this.st.mode === 'paused') {
      this.recorderMode = 'idle';
      this.set({ mode: 'idle', startedAt: undefined });
      await this.broadcast();
    }
    this.buffer = [];
    return this.state();
  }

  async addAssertion(kind: 'url' | 'title') {
    const page = this.activePage();
    if (!page || !this.isRecording()) return;
    const tab = this.pages.indexOf(page);
    const expected = kind === 'url' ? page.url() : await page.title();
    this.addStep(newStep('assert', { tab, assert: { kind, op: 'equals', expected } }));
  }

  // ── Picking and inspection ────────────────────────────────────────────
  async pick(): Promise<Target | null> {
    if (!this.isOpen()) throw new Error('Open the live browser first');
    this.pickResolve?.(null);
    this.modeBeforePick = this.st.mode === 'picking' ? this.modeBeforePick : this.st.mode;
    this.recorderMode = 'pick';
    this.set({ mode: 'picking' });
    await this.broadcast();
    await this.activePage()?.bringToFront().catch(() => undefined);
    return new Promise<Target | null>((resolve) => {
      this.pickResolve = (t) => {
        this.pickResolve = undefined;
        const back = this.modeBeforePick === 'picking' ? 'idle' : this.modeBeforePick;
        this.recorderMode = back === 'recording' ? 'record' : 'idle';
        if (this.isOpen()) {
          this.set({ mode: back });
          void this.broadcast();
        }
        this.hooks.emit({ type: 'picked', target: t });
        resolve(t);
      };
    });
  }

  cancelPick() {
    this.pickResolve?.(null);
  }

  private pageForTab(tab?: number): Page | undefined {
    if (tab !== undefined) {
      const p = this.pages[tab];
      if (p && !p.isClosed()) return p;
    }
    return this.activePage();
  }

  async testTarget(target: Target, tab?: number): Promise<TargetTestResult> {
    const page = this.pageForTab(tab);
    if (!page) throw new Error('Open the live browser first');
    const frame = await resolveFrame(page, target.framePath);
    if (!frame) return { frameFound: false, candidates: [], bestIndex: -1 };
    const candidates: TargetTestResult['candidates'] = [];
    let bestIndex = -1;
    for (let i = 0; i < target.selectors.length; i++) {
      const loc = candidateLocator(frame, target.selectors[i]);
      const count = await loc.count().catch(() => 0);
      const visible = count > 0 ? await loc.first().isVisible().catch(() => false) : false;
      candidates.push({ index: i, count, visible });
      if (bestIndex < 0 && count === 1) bestIndex = i;
    }
    return { frameFound: true, candidates, bestIndex };
  }

  async highlight(target: Target, tab?: number): Promise<TargetTestResult> {
    const page = this.pageForTab(tab);
    if (!page) throw new Error('Open the live browser first');
    const result = await this.testTarget(target, tab);
    try {
      const r = await resolveTarget(page, target, { timeout: 2500, autoHeal: false });
      await page.bringToFront().catch(() => undefined);
      await r.locator.evaluate((el, label) => window.__xero?.flash(el as Element, label, 'info'), target.description);
    } catch {
      /* nothing to flash */
    }
    return result;
  }

  async saveSession(name: string): Promise<SavedSession | null> {
    if (!this.context) return null;
    const state = await this.context.storageState();
    return this.hooks.saveSession(name, state);
  }

  // ── Playback in the live browser ──────────────────────────────────────
  async play(opts: LivePlayOptions): Promise<{ status: 'passed' | 'failed' | 'stopped'; vars: Record<string, string> }> {
    if (!this.isOpen() || !this.context) throw new Error('Open the live browser first');
    if (this.st.mode === 'recording' || this.st.mode === 'paused') await this.stopRecording();
    if (this.st.mode === 'playing') throw new Error('Playback is already running');
    const settings = this.hooks.settings();
    const run = mergeRunOptions(settings.runDefaults, {
      speed: opts.speed,
      stepRetries: 0,
      screenshots: 'none',
      dataLocale: opts.dataLocale ?? settings.dataLocale,
      autoHeal: true,
      typingMode: settings.runDefaults.typingMode,
    });
    const vars = { ...opts.variables };
    const scope = createGeneratorScope(run.dataLocale, { emailDomain: settings.emailDomain, iteration: 1 });
    const ctl = { paused: false, stepOnce: false, stop: false };
    this.playCtl = ctl;
    const total = Math.max(0, opts.to - opts.from + 1);
    const exec = new Executor(
      this.context,
      { run, vars, scope, recorderSource: RECORDER_SOURCE, headed: true, attachListeners: false, pages: this.pages, lenientTabs: true },
      {
        log: (level, msg) => {
          if (level === 'warn' || level === 'error') this.notice(level, msg);
        },
        onStepStart: (index, step) => {
          this.set({ playback: { index, total, paused: false } });
          this.hooks.emit({ type: 'stepStatus', stepId: step.id, index, status: 'running' });
        },
        onStepEnd: (index, step, r) => {
          this.hooks.emit({ type: 'stepStatus', stepId: step.id, index, status: r.status, error: r.error, duration: r.duration, message: r.message, healed: r.healed, value: r.value });
        },
        beforeStep: async (index, step) => {
          if ((step.breakpoint && opts.pauseOnBreakpoints && index !== opts.from) || ctl.stepOnce) {
            ctl.stepOnce = false;
            ctl.paused = true;
          }
          if (ctl.paused) {
            this.set({ playback: { index, total, paused: true } });
            this.hooks.emit({ type: 'stepStatus', stepId: step.id, index, status: 'pending', message: 'Paused here' });
          }
          while (ctl.paused && !ctl.stop && this.isOpen()) await sleep(80);
        },
        shouldStop: () => ctl.stop || !this.isOpen(),
        onHealed: (step, field, target) => {
          if (field === 'target') this.hooks.emit({ type: 'healed', stepId: step.id, target });
        },
      },
    );
    this.exec = exec;
    this.set({ mode: 'playing', playback: { index: opts.from, total, paused: false } });
    try {
      const out = await exec.run(opts.steps, opts.from, opts.to);
      this.hooks.emit({ type: 'vars', vars: { ...exec.vars } });
      if (out.status === 'failed' && out.error) this.notice('error', `Step ${(out.failedIndex ?? 0) + 1} failed: ${out.error}`);
      return { status: out.status, vars: { ...exec.vars } };
    } finally {
      this.exec = undefined;
      this.playCtl = undefined;
      if (this.isOpen()) this.set({ mode: 'idle', playback: undefined });
    }
  }

  playControl(cmd: 'pause' | 'resume' | 'step' | 'stop') {
    const ctl = this.playCtl;
    if (!ctl) return;
    if (cmd === 'pause') ctl.paused = true;
    if (cmd === 'resume') ctl.paused = false;
    if (cmd === 'step') {
      ctl.stepOnce = true;
      ctl.paused = false;
    }
    if (cmd === 'stop') {
      ctl.stop = true;
      ctl.paused = false;
    }
  }
}
