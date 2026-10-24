import type { ElementHandle, Frame, Locator, Page } from 'playwright-core';
import type { ElementFingerprint, FrameRef, SelectorCandidate, Target } from '../../shared/types';

const cssStr = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function candidateLocator(scope: Frame | Page, c: SelectorCandidate): Locator {
  let loc: Locator;
  switch (c.kind) {
    case 'testid':
      loc = scope.locator(`[${c.attr ?? 'data-testid'}="${cssStr(c.value)}"]`);
      break;
    case 'role':
      loc = scope.getByRole(c.value as Parameters<Page['getByRole']>[0], c.name ? { name: c.name, exact: true } : undefined);
      break;
    case 'label':
      loc = scope.getByLabel(c.value, { exact: true });
      break;
    case 'placeholder':
      loc = scope.getByPlaceholder(c.value, { exact: true });
      break;
    case 'text':
      loc = scope.getByText(c.value, { exact: true });
      break;
    case 'alt':
      loc = scope.getByAltText(c.value, { exact: true });
      break;
    case 'title':
      loc = scope.getByTitle(c.value, { exact: true });
      break;
    case 'id':
      loc = scope.locator(`[id="${cssStr(c.value)}"]`);
      break;
    case 'name':
      loc = scope.locator(`[name="${cssStr(c.value)}"]`);
      break;
    case 'xpath':
      loc = scope.locator(`xpath=${c.value}`);
      break;
    case 'css':
    default:
      loc = scope.locator(c.value);
      break;
  }
  if (c.nth !== undefined) loc = loc.nth(c.nth);
  return loc;
}

export function selectorLabel(c: SelectorCandidate): string {
  const nth = c.nth !== undefined ? ` (#${c.nth + 1})` : '';
  switch (c.kind) {
    case 'role':
      return `role=${c.value}${c.name ? ` "${c.name}"` : ''}${nth}`;
    case 'testid':
      return `${c.attr ?? 'data-testid'}="${c.value}"${nth}`;
    case 'css':
      return `css=${c.value}${nth}`;
    case 'xpath':
      return `xpath=${c.value}${nth}`;
    default:
      return `${c.kind}="${c.value}"${nth}`;
  }
}

function sameUrlish(a: string, b?: string): boolean {
  if (!b) return false;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

export async function resolveFrame(page: Page, path: FrameRef[] | undefined): Promise<Frame | null> {
  let frame: Frame = page.mainFrame();
  for (const ref of path ?? []) {
    let child: Frame | null = null;
    try {
      const handle = await frame.$(ref.selector);
      child = handle ? await handle.contentFrame() : null;
    } catch {
      child = null;
    }
    if (!child && ref.name) child = frame.childFrames().find((f) => f.name() === ref.name) ?? null;
    if (!child && ref.url) child = frame.childFrames().find((f) => sameUrlish(f.url(), ref.url)) ?? null;
    if (!child) return null;
    frame = child;
  }
  return frame;
}

export interface ResolveOptions {
  timeout: number;
  autoHeal: boolean;
  shouldStop?: () => boolean;
}

export interface Resolved {
  locator: Locator;
  frame: Frame;
  candidate?: SelectorCandidate;
  index: number;
  healed?: boolean;
  ambiguous?: boolean;
}

export class ElementNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElementNotFoundError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function firstVisible(loc: Locator): Promise<Locator | null> {
  const n = Math.min(await loc.count().catch(() => 0), 12);
  for (let i = 0; i < n; i++) {
    const item = loc.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

/**
 * Finds the element for a recorded target. Tries every selector candidate in order
 * of robustness, waits for the page to settle, and as a last resort "heals" the
 * target by scoring visible elements against the recorded fingerprint.
 */
export async function resolveTarget(page: Page, target: Target, opts: ResolveOptions): Promise<Resolved> {
  const start = Date.now();
  const deadline = start + Math.max(500, opts.timeout);
  let healTried = false;
  let ambiguous: { loc: Locator; c: SelectorCandidate; i: number; frame: Frame } | null = null;
  let frameMissing = false;

  while (true) {
    if (opts.shouldStop?.()) throw new Error('Stopped');
    const frame = await resolveFrame(page, target.framePath);
    frameMissing = !frame;
    if (frame) {
      ambiguous = null;
      for (let i = 0; i < target.selectors.length; i++) {
        const c = target.selectors[i];
        let loc: Locator;
        try {
          loc = candidateLocator(frame, c);
        } catch {
          continue;
        }
        const n = await loc.count().catch(() => -1);
        if (n === 1) return { locator: loc, frame, candidate: c, index: i };
        if (n > 1 && !ambiguous) ambiguous = { loc, c, i, frame };
      }
      const elapsed = Date.now() - start;
      if (ambiguous && elapsed > Math.min(2500, opts.timeout * 0.35)) {
        const vis = await firstVisible(ambiguous.loc);
        if (vis) return { locator: vis, frame, candidate: ambiguous.c, index: ambiguous.i, ambiguous: true };
      }
      if (opts.autoHeal && !healTried && elapsed > Math.min(4000, opts.timeout * 0.45)) {
        healTried = true;
        const healed = await healTarget(frame, target.fingerprint);
        if (healed) return { locator: healed, frame, index: -1, healed: true };
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(Date.now() - start < 2000 ? 150 : 300);
  }
  if (ambiguous) return { locator: ambiguous.loc.first(), frame: ambiguous.frame, candidate: ambiguous.c, index: ambiguous.i, ambiguous: true };
  throw new ElementNotFoundError(
    frameMissing
      ? `The frame containing ${target.description} was not found.`
      : `Could not find ${target.description} within ${Math.round(opts.timeout / 1000)} s (tried ${target.selectors.length} selector${target.selectors.length === 1 ? '' : 's'}).`,
  );
}

/** Scores visible elements of the same tag against the recorded fingerprint. */
export async function healTarget(frame: Frame, fp: ElementFingerprint): Promise<Locator | null> {
  const token = `h${Math.random().toString(36).slice(2, 9)}`;
  const score = await frame
    .evaluate(
      ([fp, token]) => {
        const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const testAttrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-automation-id', 'data-e2e', 'data-pw'];
        const els = Array.from(document.querySelectorAll(fp.tag)).slice(0, 3000);
        let best: Element | null = null;
        let bestScore = 0;
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          let s = 0;
          let max = 0;
          const cmp = (w: number, want: string | undefined, have: string | null | undefined) => {
            if (!want) return;
            max += w;
            const h = norm(have);
            if (!h) return;
            if (h === want) s += w;
            else if (want.length > 3 && (h.includes(want) || want.includes(h))) s += w * 0.5;
          };
          const testId = testAttrs.map((a) => el.getAttribute(a)).find(Boolean);
          cmp(5, fp.testId, testId);
          cmp(4, fp.id, el.getAttribute('id'));
          cmp(3, fp.name, el.getAttribute('name'));
          cmp(1.5, fp.type, el.getAttribute('type'));
          cmp(3, fp.ariaLabel, el.getAttribute('aria-label'));
          cmp(3, fp.placeholder, el.getAttribute('placeholder'));
          const labels = (el as HTMLInputElement).labels;
          const labelText = labels && labels.length ? norm(Array.from(labels).map((l) => l.textContent).join(' ')) : norm(el.getAttribute('aria-label'));
          cmp(3, fp.label, labelText || norm((el as HTMLElement).innerText).slice(0, 120));
          cmp(4, fp.text, norm((el as HTMLElement).innerText ?? el.textContent).slice(0, 120));
          cmp(2, fp.href, el.getAttribute('href'));
          cmp(2, fp.title, el.getAttribute('title'));
          cmp(2, fp.alt, el.getAttribute('alt'));
          cmp(2, fp.value, (el as HTMLInputElement).value);
          if (fp.classes?.length) {
            max += 2;
            const shared = fp.classes.filter((c) => el.classList.contains(c)).length;
            s += (2 * shared) / fp.classes.length;
          }
          const ratio = max ? s / max : 0;
          if (ratio > bestScore) {
            bestScore = ratio;
            best = el;
          }
        }
        if (best && bestScore >= 0.55) {
          best.setAttribute('data-xero-heal', token);
          return bestScore;
        }
        return 0;
      },
      [fp, token] as [ElementFingerprint, string],
    )
    .catch(() => 0);
  if (!score) return null;
  return frame.locator(`[data-xero-heal="${token}"]`);
}

/**
 * Element handles from file choosers and frame elements live in Playwright's isolated
 * world, where the recorder helpers do not exist. Tag the element, then re-select it
 * with a locator, which evaluates in the page's main world.
 */
async function withMainWorld<T>(handle: ElementHandle, recorderSource: string | undefined, use: (loc: Locator) => Promise<T>): Promise<T | null> {
  const frame = await handle.ownerFrame();
  if (!frame) return null;
  const token = `t${Math.random().toString(36).slice(2, 10)}`;
  try {
    await handle.evaluate((el, t) => (el as Element).setAttribute('data-xero-tmp', t), token);
    const loc = frame.locator(`[data-xero-tmp="${token}"]`).first();
    if (recorderSource) {
      const has = await loc.evaluate(() => typeof window.__xero?.describe === 'function');
      if (!has) await frame.evaluate(recorderSource).catch(() => undefined);
    }
    return await use(loc);
  } catch {
    return null;
  } finally {
    await handle.evaluate((el) => (el as Element).removeAttribute('data-xero-tmp')).catch(() => undefined);
  }
}

/** Builds a fresh target for an element using the injected recorder helpers. */
export async function describeHandle(handle: ElementHandle, recorderSource: string): Promise<Target | null> {
  return withMainWorld(handle, recorderSource, (loc) =>
    loc.evaluate((el) => {
      el.removeAttribute('data-xero-tmp');
      return window.__xero ? window.__xero.describe(el) : null;
    }),
  );
}

export async function framePathOf(frame: Frame, recorderSource?: string): Promise<FrameRef[]> {
  const path: FrameRef[] = [];
  let f: Frame | null = frame;
  while (f && f.parentFrame()) {
    const parent: Frame = f.parentFrame()!;
    let selector = 'iframe';
    try {
      const el = await f.frameElement();
      const css = await withMainWorld(el, recorderSource, (loc) =>
        loc.evaluate((node) => {
          node.removeAttribute('data-xero-tmp');
          const api = window.__xero;
          if (api?.cssFor) return api.cssFor(node);
          if (node.id) return `#${CSS.escape(node.id)}`;
          const name = node.getAttribute('name');
          if (name) return `${node.localName}[name="${name}"]`;
          return node.localName;
        }),
      );
      if (css) selector = css;
    } catch {
      /* keep the generic selector */
    }
    path.unshift({ selector, name: f.name() || undefined, url: f.url() || undefined });
    f = parent;
  }
  return path;
}
