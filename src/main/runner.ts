import { mkdirSync } from 'node:fs';
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core';
import type { RunEvent } from '../shared/api';
import { createGeneratorScope } from '../shared/data/catalog';
import { mergeRunOptions, uid } from '../shared/defaults';
import { renderTemplate } from '../shared/template';
import type { Dataset, Flow, IterationResult, LogEntry, Run, RunOptions, RunSummary, RunTrigger, StepResult, Target } from '../shared/types';
import { launchBrowser, parseProxy } from './browsers';
import { cleanError, Executor } from './engine/executor';
import type { Repo } from './repo';
import { summarizeRun } from './repo';

export interface RunnerDeps {
  repo: Repo;
  recorderSource: string;
  emit(e: RunEvent): void;
  onFinished?(run: RunSummary): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_LOGS = 5000;
/** Passed iterations whose per-step details are kept; older ones keep only their summary and data. */
const DETAILED_PASSED = 300;

function totalsOf(run: Run) {
  const t = { total: run.iterations.length, passed: 0, failed: 0, stopped: 0, running: 0, pending: 0 };
  for (const it of run.iterations) t[it.status === 'pending' ? 'pending' : it.status]++;
  return t;
}

class ActiveRun {
  stopped = false;
  paused = false;
  private finished = false;
  private browser?: Browser;
  private contexts = new Set<BrowserContext>();
  readonly executors = new Map<number, Executor>();
  private queue: number[] = [];
  private pendingSteps: { iteration: number; result: StepResult }[] = [];
  private pendingLogs: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private trailingEmit?: NodeJS.Timeout;
  private runEmitAt = 0;
  private proxyCursor = 0;
  private dataset?: Dataset;
  private healed = new Map<string, Target>();
  private reuse = new Map<number, BrowserContext>();
  private detailedPassed: number[] = [];

  constructor(
    readonly run: Run,
    private flow: Flow,
    private deps: RunnerDeps,
  ) {}

  private get o(): RunOptions {
    return this.run.options;
  }

  log(level: LogEntry['level'], msg: string, iteration?: number, step?: number) {
    const e: LogEntry = { t: Date.now(), level, msg, iteration, step };
    this.run.logs.push(e);
    if (this.run.logs.length > MAX_LOGS) this.run.logs.splice(0, this.run.logs.length - MAX_LOGS);
    this.pendingLogs.push(e);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 150);
  }

  private flush() {
    this.flushTimer = undefined;
    if (this.pendingSteps.length) {
      this.deps.emit({ type: 'steps', runId: this.run.id, items: this.pendingSteps });
      this.pendingSteps = [];
    }
    if (this.pendingLogs.length) {
      this.deps.emit({ type: 'log', runId: this.run.id, entries: this.pendingLogs });
      this.pendingLogs = [];
    }
  }

  private emitRun(force = false) {
    const now = Date.now();
    if (!force && now - this.runEmitAt < 250) {
      if (!this.trailingEmit) this.trailingEmit = setTimeout(() => {
        this.trailingEmit = undefined;
        this.emitRun(true);
      }, 260);
      return;
    }
    this.runEmitAt = now;
    this.run.totals = totalsOf(this.run);
    this.deps.repo.runs.track(this.run);
    this.deps.emit({ type: 'run', run: summarizeRun(this.run) });
  }

  private emitIteration(it: IterationResult) {
    this.deps.emit({ type: 'iteration', runId: this.run.id, iteration: { ...it, steps: [] } });
  }

  private async waitWhilePaused() {
    if (this.paused && this.run.status === 'running') {
      this.run.status = 'paused';
      this.emitRun(true);
    }
    while (this.paused && !this.stopped) await sleep(150);
    if (this.run.status === 'paused') {
      this.run.status = 'running';
      this.emitRun(true);
    }
  }

  private nextProxy(): string | undefined {
    const list = this.o.proxies.map((p) => p.trim()).filter(Boolean);
    if (this.o.proxyMode === 'none' || !list.length) return undefined;
    if (this.o.proxyMode === 'random') return list[Math.floor(Math.random() * list.length)];
    return list[this.proxyCursor++ % list.length];
  }

  async execute(): Promise<void> {
    const { repo } = this.deps;
    const settings = repo.settings();
    this.run.status = 'running';
    this.emitRun(true);
    const big = this.run.iterations.length > 2000;
    const keepAlive = setInterval(() => repo.runs.save(this.run), big ? 30_000 : 5000);
    try {
      if (!this.flow.steps.some((s) => s.enabled)) throw new Error('This flow has no enabled steps.');
      if (this.o.datasetId) {
        this.dataset = repo.getDataset(this.o.datasetId) ?? undefined;
        if (!this.dataset) this.log('warn', 'The selected dataset no longer exists; running without it.');
        else if (!this.dataset.rows.length) this.log('warn', `Dataset “${this.dataset.name}” is empty.`);
        else this.log('info', `Using dataset “${this.dataset.name}” (${this.dataset.rows.length} rows, ${this.o.datasetMode === 'sequential' ? 'one row per iteration' : 'random rows'}).`);
      }
      const usesProxies = this.o.proxyMode !== 'none' && this.o.proxies.some((p) => p.trim());
      const { browser, resolved } = await launchBrowser({
        choice: this.o.browser,
        customPath: settings.customBrowserPath,
        headless: this.o.headless,
        hideBanner: settings.hideAutomationBanner,
        proxy: usesProxies ? { server: 'http://per-context' } : undefined,
      });
      this.browser = browser;
      if (resolved.fellBack) this.log('warn', `The selected browser is not installed, using ${resolved.name}.`);
      this.log('info', `Started ${resolved.name}${this.o.headless ? ' in the background' : ''}: ${this.o.iterations} iteration${this.o.iterations === 1 ? '' : 's'}, ${this.o.concurrency} at a time, speed ${this.o.speed === 0 ? 'max' : `${this.o.speed}×`}.`);
      browser.on('disconnected', () => {
        if (!this.finished && !this.stopped) {
          this.stopped = true;
          this.log('error', 'The browser was closed, so the run stopped.');
        }
      });

      this.queue = this.run.iterations.map((_, i) => i);
      const workers = Math.max(1, Math.min(this.o.concurrency, this.run.iterations.length));
      await Promise.all(Array.from({ length: workers }, (_, w) => this.worker(w)));

      const t = totalsOf(this.run);
      if (this.stopped && (t.pending > 0 || t.stopped > 0)) this.run.status = 'stopped';
      else this.run.status = t.failed > 0 ? 'failed' : 'passed';
    } catch (e) {
      this.run.status = 'error';
      this.run.error = cleanError(e);
      this.log('error', this.run.error);
    } finally {
      clearInterval(keepAlive);
      this.finished = true;
      for (const it of this.run.iterations) if (it.status === 'pending' || it.status === 'running') it.status = 'stopped';
      for (const ctx of this.reuse.values()) await ctx.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
      this.run.endedAt = Date.now();
      this.run.duration = this.run.endedAt - this.run.startedAt;
      this.run.totals = totalsOf(this.run);
      this.run.healedCount = this.run.iterations.reduce((a, it) => a + it.steps.filter((s) => s.healed).length, 0);
      const t = this.run.totals;
      this.log(
        this.run.status === 'passed' ? 'success' : this.run.status === 'stopped' ? 'warn' : 'error',
        `Finished: ${t.passed} passed, ${t.failed} failed${t.stopped ? `, ${t.stopped} stopped` : ''} in ${Math.round((this.run.duration ?? 0) / 1000)} s.`,
      );
      this.flush();
      repo.runs.save(this.run);
      this.persistHealed();
      const latest = repo.getFlow(this.flow.id);
      if (latest) {
        repo.saveFlow(
          {
            ...latest,
            lastRun: { runId: this.run.id, status: this.run.status, at: this.run.startedAt, passed: t.passed, failed: t.failed, total: t.total },
            runCount: (latest.runCount ?? 0) + 1,
          },
          false,
        );
      }
      this.emitRun(true);
      this.deps.onFinished?.(summarizeRun(this.run));
    }
  }

  private persistHealed() {
    if (!this.o.saveHealedSelectors || !this.healed.size) return;
    const latest = this.deps.repo.getFlow(this.flow.id);
    if (!latest) return;
    const steps = latest.steps.map((s) => (this.healed.has(s.id) ? { ...s, target: this.healed.get(s.id) } : s));
    this.deps.repo.saveFlow({ ...latest, steps }, false);
    this.log('info', `Updated selectors for ${this.healed.size} step${this.healed.size === 1 ? '' : 's'} that had changed on the site.`);
  }

  private async worker(w: number) {
    while (!this.stopped) {
      const idx = this.queue.shift();
      if (idx === undefined) break;
      await this.waitWhilePaused();
      if (this.stopped) break;
      let it = this.run.iterations[idx];
      for (let attempt = 1; attempt <= 1 + Math.max(0, this.o.iterationRetries); attempt++) {
        it = await this.runIteration(idx, w, attempt);
        if (it.status !== 'failed' || this.stopped) break;
        if (attempt <= this.o.iterationRetries) this.log('warn', `Retrying iteration ${idx + 1} (attempt ${attempt + 1})`, idx);
      }
      if (it.status === 'failed' && this.o.stopOnFailure && !this.stopped) {
        this.stopped = true;
        this.log('warn', 'Stopping because an iteration failed and “Stop on first failure” is on.');
      }
      if (this.o.delayBetweenIterations > 0 && this.queue.length && !this.stopped) {
        const end = Date.now() + this.o.delayBetweenIterations;
        while (Date.now() < end && !this.stopped) await sleep(Math.min(200, end - Date.now()));
      }
    }
  }

  private contextOptions(proxy?: string): BrowserContextOptions {
    const { repo } = this.deps;
    const viewport = this.o.viewport ?? (this.o.headless ? { width: 1366, height: 768 } : null);
    const storageState = this.o.sessionId ? repo.sessionFile(this.o.sessionId) : undefined;
    if (this.o.sessionId && !storageState) this.log('warn', 'The selected saved login no longer exists.');
    return {
      viewport,
      userAgent: this.o.userAgent || undefined,
      locale: this.o.browserLocale || undefined,
      timezoneId: this.o.timezone || undefined,
      storageState,
      proxy: proxy ? parseProxy(proxy) : undefined,
      acceptDownloads: true,
    };
  }

  private async runIteration(index: number, worker: number, attempt: number): Promise<IterationResult> {
    const { repo, recorderSource } = this.deps;
    const settings = repo.settings();
    const it: IterationResult = {
      index,
      status: 'running',
      startedAt: Date.now(),
      attempt,
      worker,
      steps: [],
      data: {},
      variables: {},
    };
    this.run.iterations[index] = it;
    this.emitIteration(it);
    this.emitRun();

    const proxy = this.nextProxy();
    if (proxy) it.proxy = proxy.replace(/\/\/[^@]*@/, '//***@');
    let ctx: BrowserContext | undefined;
    const reuse = this.o.isolation === 'reuse';
    try {
      if (!this.browser) throw new Error('Browser is not running');
      ctx = reuse ? this.reuse.get(worker) : undefined;
      if (!ctx) {
        ctx = await this.browser.newContext(this.contextOptions(proxy));
        if (reuse) this.reuse.set(worker, ctx);
        if (this.o.blockResources.length) {
          const blocked = new Set<string>(this.o.blockResources);
          await ctx.route('**/*', (route) => (blocked.has(route.request().resourceType()) ? route.abort() : route.continue()));
        }
      }
      this.contexts.add(ctx);

      let row: Record<string, string> | undefined;
      if (this.dataset?.rows.length) {
        const rows = this.dataset.rows;
        const r = this.o.datasetMode === 'random' ? Math.floor(Math.random() * rows.length) : index % rows.length;
        row = rows[r];
        it.datasetRow = r;
      }
      const scope = createGeneratorScope(this.o.dataLocale, { emailDomain: settings.emailDomain, iteration: index + 1 });
      const vars: Record<string, string> = {};
      for (const v of this.flow.variables) {
        vars[v.name] = renderTemplate(v.value, { vars, row, persona: scope.persona, iteration: index + 1 });
      }
      const artifacts = repo.runs.artifactsDir(this.run.id);
      if (this.o.screenshots !== 'none') mkdirSync(artifacts, { recursive: true });

      const exec = new Executor(
        ctx,
        {
          run: this.o,
          vars,
          scope,
          row,
          recorderSource,
          headed: !this.o.headless,
          attachListeners: true,
          screenshotDir: this.o.screenshots !== 'none' ? artifacts : undefined,
          screenshotPrefix: `i${index + 1}`,
        },
        {
          log: (level, msg, step) => this.log(level, msg, index, step),
          shouldStop: () => this.stopped,
          beforeStep: () => this.waitWhilePaused(),
          onStepStart: (i, step) => {
            const r: StepResult = { stepId: step.id, index: i, status: 'running', startedAt: Date.now(), duration: 0 };
            this.pendingSteps.push({ iteration: index, result: r });
            this.scheduleFlush();
          },
          onStepEnd: (i, _step, r) => {
            it.steps = it.steps.filter((s) => s.index !== i);
            it.steps.push(r);
            this.pendingSteps.push({ iteration: index, result: r });
            this.scheduleFlush();
            if (r.status === 'failed') this.log('error', `Step ${i + 1} failed: ${r.error}`, index, i);
          },
          onHealed: (step, field, target) => {
            if (field === 'target') this.healed.set(step.id, target);
          },
        },
      );
      this.executors.set(index, exec);
      const page = await ctx.newPage();
      exec.addPage(page);
      const out = await exec.run(this.flow.steps);
      it.status = out.status === 'passed' ? 'passed' : out.status === 'stopped' ? 'stopped' : 'failed';
      it.error = out.error;
      it.failedStep = out.failedIndex;
      it.data = { ...exec.data };
      it.variables = { ...exec.vars };
      if (this.o.screenshots === 'end' && !this.stopped) it.screenshot = await exec.finalScreenshot();
    } catch (e) {
      it.status = this.stopped ? 'stopped' : 'failed';
      it.error = this.stopped ? 'Stopped' : cleanError(e);
    } finally {
      this.executors.delete(index);
      if (ctx) {
        this.contexts.delete(ctx);
        if (!reuse) await ctx.close().catch(() => undefined);
      }
    }
    it.endedAt = Date.now();
    it.duration = it.endedAt - (it.startedAt ?? it.endedAt);
    if (it.status === 'passed') {
      this.detailedPassed.push(index);
      if (this.detailedPassed.length > DETAILED_PASSED) {
        const old = this.run.iterations[this.detailedPassed.shift()!];
        if (old) old.steps = [];
      }
    }
    const secs = ((it.duration ?? 0) / 1000).toFixed(1);
    if (it.status === 'passed') this.log('success', `Iteration ${index + 1} passed in ${secs} s`, index);
    else if (it.status === 'failed') this.log('error', `Iteration ${index + 1} failed${it.failedStep !== undefined ? ` at step ${it.failedStep + 1}` : ''}: ${it.error ?? 'unknown error'}`, index);
    this.emitIteration(it);
    this.flush();
    this.emitRun();
    return it;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.paused = false;
    this.log('warn', 'Stopping…');
    await Promise.all([...this.contexts].map((c) => c.close().catch(() => undefined)));
  }

  async peek(iteration?: number): Promise<string | null> {
    let exec = iteration !== undefined ? this.executors.get(iteration) : undefined;
    if (!exec) exec = [...this.executors.values()][0];
    if (!exec) return null;
    const page = [...exec.pages].reverse().find((p) => !p.isClosed());
    if (!page) return null;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 2500 });
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

export class RunManager {
  private active = new Map<string, ActiveRun>();

  constructor(private deps: RunnerDeps) {}

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  activeForSchedule(scheduleId: string): boolean {
    return [...this.active.values()].some((a) => a.run.scheduleId === scheduleId);
  }

  start(flowId: string, overrides: Partial<RunOptions>, trigger: RunTrigger = 'manual', scheduleId?: string): string {
    const { repo } = this.deps;
    const flow = repo.getFlow(flowId);
    if (!flow) throw new Error('Flow not found');
    const settings = repo.settings();
    const options = mergeRunOptions(settings.runDefaults, flow.runDefaults, overrides);
    options.iterations = Math.max(1, Math.min(100_000, Math.round(options.iterations || 1)));
    options.concurrency = Math.max(1, Math.min(16, Math.round(options.concurrency || 1), options.iterations));
    if (!options.headless && options.concurrency > 6) options.concurrency = 6;
    const run: Run = {
      id: uid('r'),
      flowId,
      flowName: flow.name,
      status: 'queued',
      trigger,
      scheduleId,
      options,
      startedAt: Date.now(),
      totals: { total: options.iterations, passed: 0, failed: 0, stopped: 0, running: 0, pending: options.iterations },
      iterations: Array.from({ length: options.iterations }, (_, index) => ({ index, status: 'pending', attempt: 0, steps: [], data: {}, variables: {} })),
      logs: [],
      steps: structuredClone(flow.steps),
    };
    repo.runs.save(run);
    const ar = new ActiveRun(run, structuredClone(flow), this.deps);
    this.active.set(run.id, ar);
    void ar.execute().finally(() => {
      this.active.delete(run.id);
      const removed = repo.runs.prune(Math.max(10, repo.settings().keepRuns), (id) => this.active.has(id));
      for (const id of removed) this.deps.emit({ type: 'removed', runId: id });
    });
    return run.id;
  }

  async stop(id: string) {
    await this.active.get(id)?.stop();
  }

  pause(id: string) {
    const a = this.active.get(id);
    if (a) {
      a.paused = true;
      a.log('info', 'Paused. Iterations already in progress pause before their next step.');
    }
  }

  resume(id: string) {
    const a = this.active.get(id);
    if (a) {
      a.paused = false;
      a.log('info', 'Resumed');
    }
  }

  async peek(id: string, iteration?: number) {
    return (await this.active.get(id)?.peek(iteration)) ?? null;
  }

  getLive(id: string): Run | undefined {
    return this.active.get(id)?.run;
  }

  async stopAll() {
    await Promise.all([...this.active.values()].map((a) => a.stop()));
  }

  activeCount(): number {
    return this.active.size;
  }
}
