import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Dialog, FileChooser, Frame, Locator, Page } from 'playwright-core';
import { generateValue, getDataType, type GeneratorScope } from '../../shared/data/catalog';
import { fieldLabel } from '../../shared/data/detect';
import type { CompareOp, LogEntry, RunOptions, Step, StepResult, Target } from '../../shared/types';
import { candidateLocator, describeHandle, resolveFrame, resolveTarget, selectorLabel } from './locate';
import { render, resolveValue, type ValueContext } from './values';

export interface ExecHooks {
  log(level: LogEntry['level'], msg: string, stepIndex?: number): void;
  onStepStart?(index: number, step: Step): void;
  onStepEnd?(index: number, step: Step, result: StepResult): void;
  beforeStep?(index: number, step: Step): Promise<void>;
  shouldStop(): boolean;
  onHealed?(step: Step, field: 'target' | 'destination', target: Target): void;
}

export interface ExecOptions {
  run: RunOptions;
  vars: Record<string, string>;
  scope: GeneratorScope;
  row?: Record<string, string>;
  recorderSource: string;
  headed: boolean;
  /** Runner: listen for dialogs/file choosers itself. Live sessions forward them. */
  attachListeners: boolean;
  /** Shared tab list (live sessions). */
  pages?: Page[];
  /** Fall back to the last open tab when a recorded tab index is missing. */
  lenientTabs?: boolean;
  screenshotDir?: string;
  screenshotPrefix?: string;
}

export interface ExecOutcome {
  status: 'passed' | 'failed' | 'stopped';
  failedIndex?: number;
  error?: string;
  results: StepResult[];
}

interface StepExtra {
  message?: string;
  usedSelector?: string;
  healed?: StepResult['healed'];
  value?: string;
  screenshot?: string;
  warning?: boolean;
}

class AssertionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionFailure';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  let msg = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const cut = msg.indexOf('Call log:');
  if (cut > 0) msg = msg.slice(0, cut);
  msg = msg.replace(/^(locator|page|frame|elementHandle|browserContext)\.\w+:\s*/i, '');
  msg = msg.replace(/=+ logs =+[\s\S]*$/m, '');
  return norm(msg).slice(0, 400) || 'Unknown error';
}

export function compareValues(actual: string, op: CompareOp, expected: string): boolean {
  const a = norm(actual);
  const e = norm(expected);
  switch (op) {
    case 'equals':
      return a === e;
    case 'notEquals':
      return a !== e;
    case 'contains':
      return a.includes(e);
    case 'notContains':
      return !a.includes(e);
    case 'startsWith':
      return a.startsWith(e);
    case 'endsWith':
      return a.endsWith(e);
    case 'matches': {
      try {
        const m = expected.match(/^\/(.*)\/([gimsuy]*)$/s);
        const re = m ? new RegExp(m[1], m[2]) : new RegExp(expected);
        return re.test(actual);
      } catch {
        return false;
      }
    }
    case 'greaterThan':
    case 'lessThan': {
      const na = parseFloat(a.replace(/[^\d.-]/g, ''));
      const ne = parseFloat(e.replace(/[^\d.-]/g, ''));
      if (Number.isNaN(na) || Number.isNaN(ne)) return false;
      return op === 'greaterThan' ? na > ne : na < ne;
    }
  }
}

const OP_TEXT: Record<CompareOp, string> = {
  equals: 'to be',
  notEquals: 'not to be',
  contains: 'to contain',
  notContains: 'not to contain',
  startsWith: 'to start with',
  endsWith: 'to end with',
  matches: 'to match',
  greaterThan: 'to be greater than',
  lessThan: 'to be less than',
};

export class Executor {
  readonly pages: Page[];
  readonly vars: Record<string, string>;
  readonly data: Record<string, string> = {};
  healedCount = 0;
  private steps: Step[] = [];
  private current = -1;
  private consumed = new Set<string>();
  private uploadBusy = false;
  private activeTab = 0;
  private valueCtx: ValueContext;

  constructor(
    readonly context: BrowserContext,
    private o: ExecOptions,
    private hooks: ExecHooks,
  ) {
    this.pages = o.pages ?? [];
    this.vars = o.vars;
    this.valueCtx = { scope: o.scope, vars: this.vars, row: o.row };
    if (o.attachListeners) {
      for (const p of context.pages()) this.addPage(p);
      context.on('page', (p) => this.addPage(p));
    }
  }

  get scope(): GeneratorScope {
    return this.o.scope;
  }

  addPage(p: Page): void {
    if (!this.pages.includes(p)) this.pages.push(p);
    p.setDefaultTimeout(this.o.run.stepTimeout);
    p.setDefaultNavigationTimeout(this.o.run.navigationTimeout);
    if (this.o.attachListeners) {
      p.on('dialog', (d) => void this.handleDialog(d));
      p.on('filechooser', (fc) => void this.handleFileChooser(fc));
    }
  }

  // ── Dialogs and file choosers ──────────────────────────────────────────
  private findUpcoming(type: 'dialog' | 'upload'): Step | undefined {
    for (let i = Math.max(0, this.current); i < Math.min(this.steps.length, this.current + 4); i++) {
      const s = this.steps[i];
      if (!s?.enabled) continue;
      if (s.type === type && !this.consumed.has(s.id)) return s;
    }
    return undefined;
  }

  async handleDialog(d: Dialog): Promise<void> {
    const next = this.findUpcoming('dialog');
    try {
      if (next?.dialog) {
        this.consumed.add(next.id);
        if (next.dialog.action === 'dismiss') await d.dismiss();
        else await d.accept(render(next.dialog.promptText, this.valueCtx) || d.defaultValue());
        this.hooks.log('info', `${next.dialog.action === 'dismiss' ? 'Dismissed' : 'Accepted'} ${d.type()} “${d.message().slice(0, 80)}”`);
      } else {
        await d.accept();
        if (d.type() !== 'beforeunload') this.hooks.log('warn', `Accepted an unexpected ${d.type()}: “${d.message().slice(0, 80)}”`);
      }
    } catch {
      /* already handled */
    }
  }

  async handleFileChooser(fc: FileChooser): Promise<void> {
    if (this.uploadBusy) return;
    const next = this.findUpcoming('upload');
    try {
      if (next) {
        const files = this.checkFiles(next.files);
        this.consumed.add(next.id);
        await fc.setFiles(files);
        this.hooks.log('info', `Attached ${files.length} file${files.length === 1 ? '' : 's'} to the file picker`);
      } else {
        await fc.setFiles([]);
      }
    } catch (e) {
      this.hooks.log('error', `File picker: ${cleanError(e)}`);
    }
  }

  private checkFiles(files?: string[]): string[] {
    const out = (files ?? []).map((f) => render(f, this.valueCtx)).filter(Boolean);
    for (const f of out) if (!existsSync(f)) throw new Error(`File not found: ${f}`);
    return out;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private async sleep(ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.hooks.shouldStop()) return;
      await sleep(Math.min(100, end - Date.now()));
    }
  }

  private async page(tab = 0, timeout = 10000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (true) {
      const p = this.pages[tab];
      if (p && !p.isClosed()) return p;
      if (this.o.lenientTabs) {
        const open = this.pages.filter((x) => !x.isClosed());
        if (open.length && (p?.isClosed() || tab >= this.pages.length)) return open[open.length - 1];
      }
      if (p?.isClosed()) throw new Error(`Tab ${tab + 1} was closed`);
      if (Date.now() > deadline) throw new Error(`Tab ${tab + 1} did not open`);
      if (this.hooks.shouldStop()) throw new Error('Stopped');
      await sleep(100);
    }
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
  }

  private async locate(page: Page, target: Target, timeout: number, step: Step, field: 'target' | 'destination' = 'target') {
    const r = await resolveTarget(page, target, { timeout, autoHeal: this.o.run.autoHeal, shouldStop: () => this.hooks.shouldStop() });
    let healed: StepResult['healed'];
    if (r.healed) {
      this.healedCount++;
      const handle = await r.locator.elementHandle().catch(() => null);
      const fresh = handle ? await describeHandle(handle, this.o.recorderSource) : null;
      if (fresh) {
        fresh.framePath = target.framePath;
        const best = fresh.selectors[0];
        if (best) healed = { kind: best.kind, value: best.value, name: best.name };
        this.hooks.onHealed?.(step, field, fresh);
      } else healed = { kind: 'css', value: '[healed]' };
      this.hooks.log('warn', `Selectors for ${target.description} no longer matched; found it by similarity instead`, this.current);
    } else if (r.ambiguous) {
      this.hooks.log('debug', `${target.description}: several elements matched, used the first visible one`, this.current);
    }
    return { loc: r.locator, frame: r.frame, used: r.candidate ? selectorLabel(r.candidate) : 'healed by similarity', healed };
  }

  private remaining(start: number, timeout: number): number {
    return Math.max(2000, timeout - (Date.now() - start));
  }

  private dataKey(step: Step): string {
    let key = fieldLabel(step.field, step.target?.description ?? 'Field');
    if (key in this.data) {
      let n = 2;
      while (`${key} (${n})` in this.data) n++;
      key = `${key} (${n})`;
    }
    return key;
  }

  private async snap(index: number, kind: string, opts: { fullPage?: boolean; locator?: Locator; page?: Page; png?: boolean } = {}): Promise<string | undefined> {
    if (!this.o.screenshotDir) return undefined;
    try {
      mkdirSync(this.o.screenshotDir, { recursive: true });
      const ext = opts.png ? 'png' : 'jpg';
      const file = `${this.o.screenshotPrefix ?? 'shot'}-s${String(index + 1).padStart(3, '0')}-${kind}-${Date.now().toString(36)}.${ext}`;
      const path = join(this.o.screenshotDir, file);
      const shotOpts = opts.png ? { path, timeout: 8000 } : { path, type: 'jpeg' as const, quality: 70, timeout: 8000 };
      if (opts.locator) await opts.locator.screenshot(shotOpts);
      else {
        const page = opts.page ?? this.pages[this.activeTab] ?? this.pages.find((p) => !p.isClosed());
        if (!page || page.isClosed()) return undefined;
        await page.screenshot({ ...shotOpts, fullPage: opts.fullPage });
      }
      return file;
    } catch {
      return undefined;
    }
  }

  async finalScreenshot(): Promise<string | undefined> {
    return this.snap(this.steps.length, 'end');
  }

  // ── Run loop ──────────────────────────────────────────────────────────
  async run(steps: Step[], from = 0, to = steps.length - 1): Promise<ExecOutcome> {
    this.steps = steps;
    const results: StepResult[] = [];
    let first = true;
    for (let i = from; i <= to && i < steps.length; i++) {
      const step = steps[i];
      if (this.hooks.shouldStop()) return { status: 'stopped', results };
      if (!step.enabled) {
        const r: StepResult = { stepId: step.id, index: i, status: 'skipped', startedAt: Date.now(), duration: 0, message: 'Disabled' };
        results.push(r);
        this.hooks.onStepEnd?.(i, step, r);
        continue;
      }
      await this.hooks.beforeStep?.(i, step);
      if (this.hooks.shouldStop()) return { status: 'stopped', results };
      this.current = i;
      if (!first) await this.pace(step);
      first = false;
      const r = await this.runStepWithRetries(step, i);
      results.push(r);
      if (this.hooks.shouldStop()) return { status: 'stopped', results };
      if (r.status === 'failed') return { status: 'failed', failedIndex: i, error: r.error, results };
    }
    return { status: 'passed', results };
  }

  private async pace(step: Step): Promise<void> {
    const r = this.o.run;
    if (r.speed === 0) return;
    let ms = r.useRecordedTiming && typeof step.recordedDelay === 'number' ? Math.min(step.recordedDelay, 10000) : r.stepDelay;
    ms /= r.speed || 1;
    if (r.humanize) ms *= 0.55 + Math.random() * 0.9;
    if (ms > 4) await this.sleep(ms);
  }

  private async runStepWithRetries(step: Step, index: number): Promise<StepResult> {
    const noRetry = step.type === 'assert' || step.type === 'wait' || step.type === 'dialog' || step.type === 'script' || step.type === 'waitFor';
    const attempts = 1 + (noRetry ? 0 : Math.max(0, step.retries ?? this.o.run.stepRetries));
    const startedAt = Date.now();
    this.hooks.onStepStart?.(index, step);
    let lastErr: unknown;
    for (let a = 1; a <= attempts; a++) {
      try {
        if (step.delayBefore) await this.sleep(step.delayBefore);
        const extra = await this.execute(step, index, a === attempts);
        const result: StepResult = {
          stepId: step.id,
          index,
          status: extra.warning ? 'warning' : 'passed',
          startedAt,
          duration: Date.now() - startedAt,
          message: extra.message,
          usedSelector: extra.usedSelector,
          healed: extra.healed,
          value: extra.value,
          screenshot: extra.screenshot,
          attempts: a,
        };
        if (this.o.run.screenshots === 'step' && !result.screenshot) result.screenshot = await this.snap(index, 'step');
        this.hooks.onStepEnd?.(index, step, result);
        return result;
      } catch (e) {
        lastErr = e;
        if (this.hooks.shouldStop()) break;
        if (a < attempts) {
          this.hooks.log('warn', `Step ${index + 1} failed (attempt ${a} of ${attempts}): ${cleanError(e)} Retrying…`, index);
          await this.sleep(500);
        }
      }
    }
    const error = this.hooks.shouldStop() ? 'Stopped' : cleanError(lastErr);
    const result: StepResult = {
      stepId: step.id,
      index,
      status: step.optional ? 'warning' : 'failed',
      startedAt,
      duration: Date.now() - startedAt,
      error,
      message: step.optional ? 'Optional step failed, continuing' : undefined,
      attempts,
    };
    if (!this.hooks.shouldStop() && (this.o.run.screenshots === 'failure' || this.o.run.screenshots === 'step')) {
      result.screenshot = await this.snap(index, 'fail');
    }
    this.hooks.onStepEnd?.(index, step, result);
    return result;
  }

  // ── Step implementations ──────────────────────────────────────────────
  private async execute(step: Step, index: number, lastAttempt: boolean): Promise<StepExtra> {
    const timeout = step.timeout ?? this.o.run.stepTimeout;
    const start = Date.now();
    const page = await this.page(step.tab ?? 0, Math.max(timeout, 5000));
    const tab = this.pages.indexOf(page);
    if (tab !== this.activeTab) {
      this.activeTab = tab;
      if (this.o.headed) await page.bringToFront().catch(() => undefined);
    }
    const need = () => {
      if (!step.target) throw new Error('This step has no target element. Pick one in the step editor.');
      return step.target;
    };

    switch (step.type) {
      case 'navigate': {
        const url = render(step.url, this.valueCtx);
        if (!url) throw new Error('No URL set');
        await page.goto(url, { waitUntil: this.o.run.waitUntil, timeout: this.o.run.navigationTimeout });
        return { message: page.url() };
      }

      case 'click': {
        const { loc, used, healed } = await this.locate(page, need(), timeout, step);
        const opts = { button: step.button ?? 'left', clickCount: step.clickCount ?? 1, modifiers: step.modifiers, position: step.position, timeout: this.remaining(start, timeout) } as const;
        try {
          await loc.click(opts);
        } catch (e) {
          if (!lastAttempt || !this.o.run.autoHeal || (step.button && step.button !== 'left')) throw e;
          await loc.dispatchEvent('click', undefined, { timeout: 3000 });
          await this.settle(page);
          return { usedSelector: used, healed, warning: true, message: 'The element was covered, so a synthetic click was used' };
        }
        await this.settle(page);
        return { usedSelector: used, healed };
      }

      case 'hover': {
        const { loc, used, healed } = await this.locate(page, need(), timeout, step);
        await loc.hover({ timeout: this.remaining(start, timeout) });
        return { usedSelector: used, healed };
      }

      case 'fill': {
        const { loc, used, healed } = await this.locate(page, need(), timeout, step);
        const value = resolveValue(step.value, step, this.valueCtx);
        const kind = await loc
          .evaluate((el) => ({ tag: el.localName, type: (el as HTMLInputElement).type ?? '', editable: (el as HTMLElement).isContentEditable }))
          .catch(() => ({ tag: '', type: '', editable: false }));
        if (kind.tag === 'select') {
          const chosen = await this.chooseOption(loc, value);
          this.data[this.dataKey(step)] = chosen;
          return { usedSelector: used, healed, value: chosen };
        }
        if (kind.tag === 'input' && (kind.type === 'range' || kind.type === 'color')) {
          await loc.evaluate((el, v) => {
            const input = el as HTMLInputElement;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter ? setter.call(input, v) : (input.value = v);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }, value);
        } else {
          await this.typeInto(loc, value, this.remaining(start, timeout));
        }
        this.data[this.dataKey(step)] = value;
        return { usedSelector: used, healed, value };
      }

      case 'press': {
        const key = step.key || 'Enter';
        if (step.target) {
          const { loc, used, healed } = await this.locate(page, step.target, timeout, step);
          await loc.press(key, { timeout: this.remaining(start, timeout) });
          await this.settle(page);
          return { usedSelector: used, healed };
        }
        await page.keyboard.press(key);
        await this.settle(page);
        return {};
      }

      case 'select': {
        const { loc, used, healed } = await this.locate(page, need(), timeout, step);
        let chosen: string;
        const v = step.value;
        const recorded = step.select?.values ?? [];
        if (!v || (v.mode === 'static' && (!v.static || recorded.includes(v.static)))) {
          chosen = await this.selectRecorded(loc, step);
        } else if (v.mode === 'random' && (v.dataType === 'choice.option' || !v.dataType)) {
          chosen = await this.chooseOption(loc, null);
        } else {
          chosen = await this.chooseOption(loc, resolveValue(v, step, this.valueCtx));
        }
        if (v?.saveAs) this.vars[v.saveAs] = chosen;
        this.data[this.dataKey(step)] = chosen;
        return { usedSelector: used, healed, value: chosen };
      }

      case 'check':
      case 'uncheck': {
        const target = need();
        if (step.value?.mode === 'random' && step.value.dataType === 'choice.radio' && step.field?.radioGroup) {
          const frame = (await resolveFrame(page, target.framePath)) ?? page.mainFrame();
          const label = await this.randomRadio(frame, step.field.radioGroup, this.remaining(start, timeout));
          this.data[this.dataKey(step)] = label;
          return { value: label, message: `Chose “${label}”` };
        }
        let want = step.type === 'check';
        if (step.value?.mode === 'random') {
          want = generateValue(step.value.dataType ?? 'choice.checkbox', step.value.options, this.o.scope, step.field, step.id) === 'true';
        } else if (step.value && step.value.mode !== 'static') {
          const s = resolveValue(step.value, step, this.valueCtx).toLowerCase();
          want = ['true', 'yes', '1', 'on', 'checked', 'y'].includes(s);
        }
        const { loc, used, healed } = await this.locate(page, target, timeout, step);
        if (step.useClick) {
          const cur = await loc.isChecked().catch(() => undefined);
          if (cur === undefined || cur !== want) await loc.click({ timeout: this.remaining(start, timeout) });
        } else {
          try {
            await loc.setChecked(want, { timeout: Math.min(this.remaining(start, timeout), 6000) });
          } catch (e) {
            const cur = await loc.isChecked().catch(() => undefined);
            if (cur === want) return { usedSelector: used, healed };
            if (!lastAttempt) throw e;
            await loc.click({ force: true, timeout: 3000 });
          }
        }
        this.data[this.dataKey(step)] = want ? 'checked' : 'unchecked';
        return { usedSelector: used, healed, value: want ? 'checked' : 'unchecked' };
      }

      case 'upload': {
        if (this.consumed.has(step.id)) return { message: 'Files attached when the file picker opened' };
        const files = this.checkFiles(step.files);
        const { loc, used, healed } = await this.locate(page, need(), timeout, step);
        const isInput = await loc.evaluate((el) => el.localName === 'input' && (el as HTMLInputElement).type === 'file').catch(() => false);
        if (isInput) await loc.setInputFiles(files, { timeout: this.remaining(start, timeout) });
        else {
          this.uploadBusy = true;
          try {
            const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: this.remaining(start, timeout) }), loc.click({ timeout: this.remaining(start, timeout) })]);
            await fc.setFiles(files);
          } finally {
            this.uploadBusy = false;
          }
        }
        this.consumed.add(step.id);
        return { usedSelector: used, healed, value: files.map((f) => f.split(/[\\/]/).pop()).join(', ') };
      }

      case 'dragDrop': {
        const src = await this.locate(page, need(), timeout, step);
        if (!step.destination) throw new Error('No drop target set');
        const dst = await this.locate(page, step.destination, this.remaining(start, timeout), step, 'destination');
        try {
          await src.loc.dragTo(dst.loc, { timeout: this.remaining(start, timeout) });
        } catch (e) {
          if (!lastAttempt) throw e;
          const a = await src.loc.boundingBox();
          const b = await dst.loc.boundingBox();
          if (!a || !b) throw e;
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
          await page.mouse.down();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
          await page.mouse.up();
        }
        return { usedSelector: src.used, healed: src.healed };
      }

      case 'scroll': {
        const x = step.scroll?.x ?? 0;
        const y = step.scroll?.y ?? 0;
        if (step.target) {
          const { loc, used } = await this.locate(page, step.target, timeout, step);
          await loc.evaluate((el, p) => el.scrollTo({ left: p.x, top: p.y, behavior: 'instant' as ScrollBehavior }), { x, y });
          return { usedSelector: used };
        }
        await page.evaluate((p) => window.scrollTo({ left: p.x, top: p.y, behavior: 'instant' as ScrollBehavior }), { x, y });
        return {};
      }

      case 'wait':
        await this.sleep(step.duration ?? 1000);
        return {};

      case 'waitFor':
        return this.waitFor(step, page, timeout);

      case 'assert':
        try {
          return await this.assert(step, page, timeout);
        } catch (e) {
          if (e instanceof AssertionFailure && step.assert?.soft) return { warning: true, message: e.message };
          throw e;
        }

      case 'extract': {
        const ex = step.extract;
        if (!ex?.variable) throw new Error('Choose a variable name to save into');
        let v = '';
        let used: string | undefined;
        if (ex.source === 'url') v = page.url();
        else if (ex.source === 'title') v = await page.title();
        else {
          const r = await this.locate(page, need(), timeout, step);
          used = r.used;
          switch (ex.source) {
            case 'value':
              v = await r.loc.inputValue({ timeout: 5000 }).catch(async () => norm(await r.loc.textContent()));
              break;
            case 'attribute':
              v = (await r.loc.getAttribute(ex.attribute || 'href')) ?? '';
              break;
            case 'html':
              v = await r.loc.innerHTML();
              break;
            case 'count':
              v = String(await r.loc.count());
              break;
            default:
              v = norm(await r.loc.innerText());
          }
        }
        if (ex.regex) {
          try {
            const m = v.match(new RegExp(ex.regex));
            v = m ? (m[1] ?? m[0]) : '';
          } catch {
            throw new Error(`Invalid pattern: ${ex.regex}`);
          }
        }
        this.vars[ex.variable] = v;
        return { usedSelector: used, value: v, message: `${ex.variable} = “${v.slice(0, 120)}”` };
      }

      case 'setVariable': {
        if (!step.variable) throw new Error('Choose a variable name');
        const v = resolveValue(step.value, step, this.valueCtx);
        this.vars[step.variable] = v;
        return { value: v, message: `${step.variable} = “${v.slice(0, 120)}”` };
      }

      case 'screenshot': {
        let file: string | undefined;
        if (step.target && step.screenshot?.element) {
          const { loc } = await this.locate(page, step.target, timeout, step);
          file = await this.snap(index, step.screenshot?.name || 'shot', { locator: loc, png: true });
        } else file = await this.snap(index, step.screenshot?.name || 'shot', { fullPage: step.screenshot?.fullPage, page, png: true });
        return { screenshot: file, message: file ? 'Saved' : 'Screenshots are saved during runs' };
      }

      case 'script': {
        const code = step.code ?? '';
        const scope: Frame = step.target ? ((await resolveFrame(page, step.target.framePath)) ?? page.mainFrame()) : page.mainFrame();
        const result = await scope.evaluate(`(async (vars) => {\n${code}\n})(${JSON.stringify(this.vars)})`);
        const text = result === undefined || result === null ? '' : typeof result === 'object' ? JSON.stringify(result) : String(result);
        if (step.resultVariable) this.vars[step.resultVariable] = text;
        return { value: text, message: text ? `Returned “${text.slice(0, 120)}”` : undefined };
      }

      case 'newTab': {
        const p = await this.context.newPage();
        this.addPage(p);
        const url = render(step.url, this.valueCtx);
        if (url && url !== 'about:blank') await p.goto(url, { waitUntil: this.o.run.waitUntil, timeout: this.o.run.navigationTimeout });
        this.activeTab = this.pages.indexOf(p);
        return {};
      }

      case 'closeTab':
        if (!page.isClosed()) await page.close();
        return {};

      case 'goBack':
        await page.goBack({ waitUntil: this.o.run.waitUntil, timeout: this.o.run.navigationTimeout });
        return {};

      case 'goForward':
        await page.goForward({ waitUntil: this.o.run.waitUntil, timeout: this.o.run.navigationTimeout });
        return {};

      case 'reload':
        await page.reload({ waitUntil: this.o.run.waitUntil, timeout: this.o.run.navigationTimeout });
        return {};

      case 'dialog': {
        if (this.consumed.has(step.id)) return { message: 'Dialog answered' };
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline && !this.consumed.has(step.id) && !this.hooks.shouldStop()) await sleep(100);
        if (!this.consumed.has(step.id)) throw new Error('No dialog appeared');
        return { message: 'Dialog answered' };
      }
    }
    return {};
  }

  private async typeInto(loc: Locator, value: string, timeout: number): Promise<void> {
    const r = this.o.run;
    if (r.typingMode === 'type' && r.speed !== 0) {
      await loc.fill('', { timeout });
      const base = r.typingDelay / (r.speed || 1);
      if (r.humanize) {
        for (const ch of value) {
          if (this.hooks.shouldStop()) return;
          await loc.pressSequentially(ch, { timeout });
          await sleep(base * (0.35 + Math.random() * 1.3));
        }
      } else await loc.pressSequentially(value, { delay: base, timeout });
      return;
    }
    await loc.fill(value, { timeout });
  }

  private async listOptions(loc: Locator) {
    return loc.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options ?? []).map((o) => ({ value: o.value, label: (o.label || o.text).replace(/\s+/g, ' ').trim(), disabled: o.disabled })),
    );
  }

  private async selectRecorded(loc: Locator, step: Step): Promise<string> {
    const values = step.select?.values ?? (step.value?.static ? [step.value.static] : []);
    const labels = step.select?.labels ?? [];
    try {
      await loc.selectOption(values.map((v) => ({ value: v })), { timeout: 6000 });
      return labels.join(', ') || values.join(', ');
    } catch {
      if (!labels.length) throw new Error(`Option “${values.join(', ')}” is not available`);
      await loc.selectOption(labels.map((l) => ({ label: l })), { timeout: 4000 });
      return labels.join(', ');
    }
  }

  /** Selects the option matching `wanted` (value or label). With null, picks a random real option. */
  private async chooseOption(loc: Locator, wanted: string | null): Promise<string> {
    const options = (await this.listOptions(loc)).filter((o) => !o.disabled);
    const real = options.filter((o) => o.value !== '' && !/^(select|choose|pick|please|--|—)/i.test(o.label));
    const pool = real.length ? real : options;
    if (!pool.length) throw new Error('The dropdown has no options');
    let match = null as (typeof options)[number] | null;
    if (wanted !== null) {
      const w = wanted.trim().toLowerCase();
      match =
        options.find((o) => o.value === wanted) ??
        options.find((o) => o.label === wanted) ??
        options.find((o) => o.label.toLowerCase() === w || o.value.toLowerCase() === w) ??
        options.find((o) => w.length > 1 && (o.label.toLowerCase().startsWith(w) || w.startsWith(o.label.toLowerCase()) && o.label.length > 1)) ??
        options.find((o) => w.length > 2 && o.label.toLowerCase().includes(w)) ??
        null;
      if (!match) this.hooks.log('warn', `No option matched “${wanted}”, picked a random one instead`, this.current);
    }
    const pick = match ?? pool[Math.floor(Math.random() * pool.length)];
    await loc.selectOption({ value: pick.value }, { timeout: 6000 });
    return pick.label || pick.value;
  }

  private async randomRadio(frame: Frame, group: string, timeout: number): Promise<string> {
    const loc = frame.locator(`input[type=radio][name="${group.replace(/"/g, '\\"')}"]`);
    const n = await loc.count();
    if (!n) throw new Error(`No radio buttons named “${group}”`);
    const usable: number[] = [];
    for (let i = 0; i < n; i++) if (await loc.nth(i).isEnabled().catch(() => false)) usable.push(i);
    const idx = usable.length ? usable[Math.floor(Math.random() * usable.length)] : 0;
    const item = loc.nth(idx);
    const label = await item.evaluate((el) => {
      const input = el as HTMLInputElement;
      const l = input.labels?.[0]?.textContent ?? input.getAttribute('aria-label') ?? input.value;
      return (l ?? '').replace(/\s+/g, ' ').trim();
    });
    try {
      await item.check({ timeout: Math.min(timeout, 5000) });
    } catch {
      await item.evaluate((el) => (el as HTMLInputElement).click());
    }
    return label;
  }

  private async waitFor(step: Step, page: Page, timeout: number): Promise<StepExtra> {
    const w = step.waitFor ?? { kind: 'visible' };
    const value = render(w.value, this.valueCtx);
    switch (w.kind) {
      case 'url': {
        if (!value) throw new Error('Enter part of the URL to wait for');
        const m = value.match(/^\/(.*)\/([gimsuy]*)$/);
        const matcher = m ? new RegExp(m[1], m[2]) : value.includes('*') ? value : (u: URL) => u.href.includes(value);
        await page.waitForURL(matcher, { timeout, waitUntil: 'commit' });
        return { message: page.url() };
      }
      case 'networkIdle':
        await page.waitForLoadState('networkidle', { timeout });
        return {};
      case 'load':
        await page.waitForLoadState('load', { timeout });
        return {};
      case 'text':
        if (!value) throw new Error('Enter the text to wait for');
        await page.getByText(value).first().waitFor({ state: 'visible', timeout });
        return {};
      case 'hidden':
      case 'detached': {
        if (!step.target) throw new Error('Pick the element to wait for');
        const frame = (await resolveFrame(page, step.target.framePath)) ?? page.mainFrame();
        const best = step.target.selectors[0];
        if (!best) throw new Error('The target has no selectors');
        await candidateLocator(frame, best).first().waitFor({ state: w.kind, timeout });
        return {};
      }
      default: {
        if (!step.target) throw new Error('Pick the element to wait for');
        const { loc, used } = await this.locate(page, step.target, timeout, step);
        await loc.waitFor({ state: w.kind === 'attached' ? 'attached' : 'visible', timeout });
        return { usedSelector: used };
      }
    }
  }

  private async assert(step: Step, page: Page, timeout: number): Promise<StepExtra> {
    const a = step.assert;
    if (!a) throw new Error('No check configured');
    const expected = render(a.expected, this.valueCtx);
    const deadline = Date.now() + timeout;
    let actual = '';
    let lastErr = '';
    let used: string | undefined;
    const quick = async () => {
      const r = await resolveTarget(page, step.target!, { timeout: 400, autoHeal: false, shouldStop: () => this.hooks.shouldStop() });
      used = r.candidate ? selectorLabel(r.candidate) : undefined;
      return r.locator;
    };
    const once = async (): Promise<boolean> => {
      switch (a.kind) {
        case 'url':
          actual = page.url();
          return compareValues(actual, a.op, expected);
        case 'title':
          actual = await page.title();
          return compareValues(actual, a.op, expected);
        case 'hidden': {
          if (!step.target) throw new Error('Pick the element to check');
          try {
            const loc = await quick();
            const vis = await loc.isVisible();
            actual = vis ? 'visible' : 'hidden';
            return !vis;
          } catch {
            actual = 'not on the page';
            return true;
          }
        }
        case 'count': {
          if (!step.target) throw new Error('Pick the element to count');
          const frame = (await resolveFrame(page, step.target.framePath)) ?? page.mainFrame();
          const best = step.target.selectors.find((s) => s.nth === undefined) ?? step.target.selectors[0];
          actual = String(await candidateLocator(frame, { ...best, nth: undefined }).count());
          return compareValues(actual, a.op, expected);
        }
      }
      if (!step.target) throw new Error('Pick the element to check');
      const loc = await quick();
      switch (a.kind) {
        case 'visible':
          actual = (await loc.isVisible()) ? 'visible' : 'hidden';
          return actual === 'visible';
        case 'text':
          actual = norm(await loc.innerText({ timeout: 2000 }));
          return compareValues(actual, a.op, expected);
        case 'value':
          actual = await loc.inputValue({ timeout: 2000 }).catch(async () => norm(await loc.textContent()));
          return compareValues(actual, a.op, expected);
        case 'attribute':
          actual = (await loc.getAttribute(a.attribute || 'class')) ?? '';
          return compareValues(actual, a.op, expected);
        case 'checked': {
          const c = await loc.isChecked();
          actual = c ? 'checked' : 'unchecked';
          return a.op === 'notEquals' ? !c : c;
        }
        case 'enabled': {
          const en = await loc.isEnabled();
          actual = en ? 'enabled' : 'disabled';
          return a.op === 'notEquals' ? !en : en;
        }
      }
      return false;
    };
    while (true) {
      try {
        if (await once()) {
          const shown = ['visible', 'hidden', 'checked', 'enabled'].includes(a.kind) ? actual : `“${actual.slice(0, 120)}”`;
          return { usedSelector: used, value: actual, message: `Passed: ${shown}` };
        }
        lastErr = '';
      } catch (e) {
        lastErr = cleanError(e);
      }
      if (Date.now() >= deadline || this.hooks.shouldStop()) break;
      await sleep(250);
    }
    if (lastErr && !actual) throw new AssertionFailure(lastErr);
    const subject = a.kind === 'url' ? 'URL' : a.kind === 'title' ? 'Title' : (step.target?.description ?? 'Element');
    if (['visible', 'hidden', 'checked', 'enabled'].includes(a.kind)) {
      throw new AssertionFailure(`Expected ${subject} to be ${a.op === 'notEquals' ? 'not ' : ''}${a.kind}, but it was ${actual || 'missing'}`);
    }
    throw new AssertionFailure(`Expected ${subject} ${a.kind === 'url' || a.kind === 'title' ? '' : `${a.kind} `}${OP_TEXT[a.op]} “${expected}”, but got “${actual.slice(0, 160)}”`);
  }
}

export function isRuntimeChoice(dataType?: string): boolean {
  return !!getDataType(dataType)?.runtime;
}
