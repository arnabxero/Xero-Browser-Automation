// DOM helpers used by the recorder: visibility, ARIA roles, accessible names,
// selector generation and field metadata. Runs inside arbitrary web pages, so it
// must be defensive and fast.

import type { ElementFingerprint, FieldInfo, SelectorCandidate, Target } from '../shared/types';

export const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-automation-id', 'data-e2e', 'data-pw'];

const TEXT_INPUT_TYPES = new Set([
  '', 'text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week',
]);

export function isElement(n: unknown): n is Element {
  return !!n && (n as Node).nodeType === 1;
}

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.localName;
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

export function isFormControl(el: Element): boolean {
  const tag = el.localName;
  if (tag === 'select' || tag === 'textarea') return true;
  if (tag === 'input') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'image', 'hidden'].includes(t);
  }
  return false;
}

export function editableRoot(el: Element): Element {
  if (!(el as HTMLElement).isContentEditable) return el;
  let cur: Element = el;
  while (cur.parentElement && (cur.parentElement as HTMLElement).isContentEditable) cur = cur.parentElement;
  return cur;
}

export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity) < 0.05) return false;
  return true;
}

function isHiddenForName(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.localName === 'script' || el.localName === 'style' || el.localName === 'noscript' || el.localName === 'template') return true;
  const style = getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

// ── Roles ──────────────────────────────────────────────────────────────────

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.trim().split(/\s+/)[0].toLowerCase();
  const tag = el.localName;
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'input': {
      const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
      const list = el.hasAttribute('list');
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return list ? 'combobox' : 'searchbox';
      if (['email', 'tel', 'text', 'url', ''].includes(t)) return list ? 'combobox' : 'textbox';
      return null;
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox';
    case 'option':
      return 'option';
    case 'img':
      return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'li':
      return 'listitem';
    case 'nav':
      return 'navigation';
    case 'dialog':
      return 'dialog';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'tr':
      return 'row';
    case 'summary':
      return null;
    case 'progress':
      return 'progressbar';
  }
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return 'textbox';
  return null;
}

const NAME_FROM_CONTENT = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem',
]);

const ROLE_SELECTOR_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'heading', 'img', 'treeitem', 'gridcell', 'cell', 'columnheader',
]);

function pseudoContent(el: Element, which: '::before' | '::after'): string {
  try {
    const c = getComputedStyle(el, which).content;
    if (!c || c === 'none' || c === 'normal') return '';
    const m = c.match(/^["'](.*)["']$/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function textFromContent(el: Element, budget = { n: 0 }, skip?: Element): string {
  let out = pseudoContent(el, '::before');
  const children: Node[] = Array.from(el.childNodes);
  if ((el as HTMLElement).shadowRoot) children.push(...Array.from((el as HTMLElement).shadowRoot!.childNodes));
  for (const node of children) {
    if (++budget.n > 400) break;
    if (node.nodeType === 3) {
      out += node.textContent ?? '';
      continue;
    }
    if (!isElement(node) || node === skip) continue;
    if (isHiddenForName(node)) continue;
    const tag = node.localName;
    if (tag === 'img' || node.getAttribute('role') === 'img') {
      out += ` ${node.getAttribute('aria-label') || node.getAttribute('alt') || ''} `;
      continue;
    }
    if (tag === 'svg') {
      const t = node.getAttribute('aria-label') || node.querySelector('title')?.textContent || '';
      out += t ? ` ${t} ` : '';
      continue;
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') continue;
    const al = node.getAttribute('aria-label');
    if (al) {
      out += ` ${al} `;
      continue;
    }
    const display = getComputedStyle(node).display;
    const inner = textFromContent(node, budget, skip);
    out += display.startsWith('inline') ? inner : ` ${inner} `;
  }
  out += pseudoContent(el, '::after');
  return out;
}

function byIds(ids: string, doc: Document | ShadowRoot): string {
  return ids
    .split(/\s+/)
    .map((id) => {
      const n = (doc as Document).getElementById ? (doc as Document).getElementById(id) : doc.querySelector(`#${CSS.escape(id)}`);
      return n ? textFromContent(n) : '';
    })
    .join(' ');
}

export function labelText(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = norm(byIds(lb, root));
    if (t) return t;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = norm(Array.from(labels).map((l) => textFromContent(l, { n: 0 }, el)).join(' '));
    if (t) return t;
  }
  const wrap = el.closest('label');
  if (wrap) {
    const t = norm(textFromContent(wrap, { n: 0 }, el));
    if (t) return t;
  }
  return '';
}

export function accessibleName(el: Element, role: string | null = getRole(el)): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = norm(byIds(lb, root));
    if (t) return t;
  }
  const al = norm(el.getAttribute('aria-label'));
  if (al) return al;
  const tag = el.localName;
  if (tag === 'input') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (['button', 'submit', 'reset'].includes(t)) {
      const v = norm((el as HTMLInputElement).value);
      if (v) return v;
      return t === 'submit' ? 'Submit' : t === 'reset' ? 'Reset' : '';
    }
    if (t === 'image') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title')) || 'Submit';
  }
  if (isFormControl(el)) {
    const t = labelText(el);
    if (t) return t;
    const title = norm(el.getAttribute('title'));
    if (title) return title;
    const ph = norm(el.getAttribute('placeholder'));
    if (ph) return ph;
    return '';
  }
  if (tag === 'img') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title'));
  if (role && NAME_FROM_CONTENT.has(role)) {
    const t = norm(textFromContent(el));
    if (t) return t;
  }
  return norm(el.getAttribute('title'));
}

// ── Stability heuristics ──────────────────────────────────────────────────

export function isStableId(id: string | null): boolean {
  if (!id || id.length > 60) return false;
  if (/^\d/.test(id)) return false;
  if (id.includes(':')) return false;
  if (/\d{4,}/.test(id)) return false;
  if (/(^|[-_])(ember|react|radix|headlessui|mui|rc|vue|ng|svelte|chakra|mantine|downshift|tippy|select2|ext-gen|gwt|yui|j_id|jsx)[-_]?\w*\d/i.test(id)) return false;
  if (/[a-f0-9]{8,}/i.test(id) && /\d/.test(id) && /[a-f]/i.test(id)) return false;
  if (/^[a-z0-9]{12,}$/i.test(id) && /\d/.test(id) && /[a-z]/i.test(id)) return false;
  return true;
}

export function isStableClass(c: string): boolean {
  if (c.length < 2 || c.length > 40) return false;
  if (/[:[\]/@!%.()#,'"=]/.test(c)) return false;
  if (/^(css|sc|jsx|emotion|svelte|styled|jss|tw|chakra|mui|Mui|ant)-[a-zA-Z0-9]{4,}/.test(c)) return false;
  if (/^_|__[a-zA-Z0-9]{5,}$|--[a-zA-Z0-9_]{5,}$/.test(c)) return false;
  if (/\d/.test(c) && /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z][0-9]/.test(c)) return false;
  if (/^(active|hover|focus|focused|selected|open|opened|show|shown|visible|hidden|disabled|enabled|checked|current|collapsed|expanded|loading|loaded|animate|animated|fade|in|is-|has-|ng-|v-|js-)/.test(c)) return false;
  if (/^\d|\d{3,}/.test(c)) return false;
  return true;
}

// ── Selector uniqueness ───────────────────────────────────────────────────

function rootOf(el: Element): Document | ShadowRoot {
  return el.getRootNode() as Document | ShadowRoot;
}

function countCss(root: Document | ShadowRoot, sel: string): number {
  try {
    return root.querySelectorAll(sel).length;
  } catch {
    return -1;
  }
}

function allDeep(root: Document | ShadowRoot | Element, tagSelector: string, out: Element[] = [], depth = 0): Element[] {
  let list: NodeListOf<Element>;
  try {
    list = root.querySelectorAll(tagSelector);
  } catch {
    return out;
  }
  out.push(...Array.from(list));
  if (depth > 4) return out;
  // Walk open shadow roots, which Playwright's locators pierce too.
  const hosts = root.querySelectorAll('*');
  if (hosts.length < 4000) {
    for (const h of Array.from(hosts)) {
      const sr = (h as HTMLElement).shadowRoot;
      if (sr) allDeep(sr, tagSelector, out, depth + 1);
    }
  }
  return out;
}

const ROLE_TAGS: Record<string, string> = {
  button: 'button,input[type=button],input[type=submit],input[type=reset],input[type=image],[role=button]',
  link: 'a[href],area[href],[role=link]',
  checkbox: 'input[type=checkbox],[role=checkbox]',
  radio: 'input[type=radio],[role=radio]',
  textbox: 'input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=url],textarea,[role=textbox],[contenteditable=""],[contenteditable=true]',
  searchbox: 'input[type=search],[role=searchbox]',
  combobox: 'select,input[list],[role=combobox]',
  listbox: 'select,[role=listbox]',
  option: 'option,[role=option]',
  heading: 'h1,h2,h3,h4,h5,h6,[role=heading]',
  img: 'img,[role=img]',
  slider: 'input[type=range],[role=slider]',
  spinbutton: 'input[type=number],[role=spinbutton]',
  cell: 'td,[role=cell]',
  columnheader: 'th,[role=columnheader]',
};

function countRole(doc: Document, role: string, name: string): Element[] {
  const sel = ROLE_TAGS[role] ?? `[role="${role}"]`;
  return allDeep(doc, sel).filter((e) => getRole(e) === role && accessibleName(e, role) === name);
}

function ownText(el: Element): string {
  return norm(el.textContent);
}

function countText(doc: Document, el: Element, text: string): Element[] {
  return allDeep(doc, el.localName).filter((e) => {
    if (ownText(e) !== text) return false;
    for (const c of Array.from(e.children)) if (ownText(c) === text) return false;
    return true;
  });
}

function nthOfType(el: Element): { index: number; count: number } {
  const parent = el.parentElement ?? (el.parentNode as ParentNode | null);
  if (!parent) return { index: 1, count: 1 };
  const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
  return { index: same.indexOf(el) + 1, count: same.length };
}

function cssIdent(tag: string): string {
  return /^[a-z][a-z0-9-]*$/i.test(tag) ? tag : CSS.escape(tag);
}

function segment(el: Element, root: Document | ShadowRoot): { base: string; unique: boolean } {
  const tag = cssIdent(el.localName);
  const id = el.getAttribute('id');
  if (id && isStableId(id)) {
    const s = `${tag}#${CSS.escape(id)}`;
    if (countCss(root, s) === 1) return { base: s, unique: true };
  }
  for (const attr of TEST_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      const s = `${tag}[${attr}="${CSS.escape(v)}"]`;
      if (countCss(root, s) === 1) return { base: s, unique: true };
    }
  }
  const name = el.getAttribute('name');
  if (name && isFormControl(el)) {
    const s = `${tag}[name="${CSS.escape(name)}"]`;
    const n = countCss(root, s);
    if (n === 1) return { base: s, unique: true };
    if (el.localName === 'input' && (el as HTMLInputElement).type === 'radio') {
      const v = (el as HTMLInputElement).value;
      const s2 = `${s}[value="${CSS.escape(v)}"]`;
      if (countCss(root, s2) === 1) return { base: s2, unique: true };
    }
  }
  const classes = Array.from(el.classList).filter(isStableClass);
  if (classes.length) {
    const ranked = classes
      .map((c) => ({ c, n: countCss(root, `${tag}.${CSS.escape(c)}`) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => a.n - b.n)
      .slice(0, 2);
    if (ranked.length) {
      const s = `${tag}${ranked.map((x) => `.${CSS.escape(x.c)}`).join('')}`;
      return { base: s, unique: countCss(root, s) === 1 };
    }
  }
  const type = el.localName === 'input' ? (el as HTMLInputElement).getAttribute('type') : null;
  if (type) return { base: `${tag}[type="${CSS.escape(type)}"]`, unique: false };
  return { base: tag, unique: false };
}

function cssInRoot(el: Element): string {
  const root = rootOf(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 8) {
    const seg = segment(cur, root);
    parts.unshift(seg.base);
    let sel = parts.join(' > ');
    if (countCss(root, sel) === 1) return sel;
    const nth = nthOfType(cur);
    if (nth.count > 1) {
      parts[0] = `${seg.base}:nth-of-type(${nth.index})`;
      sel = parts.join(' > ');
      if (countCss(root, sel) === 1) return sel;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    cur = parent;
    depth++;
  }
  return parts.join(' > ');
}

/** CSS selector that Playwright can resolve, piercing open shadow roots with a descendant combinator. */
export function cssFor(el: Element): string {
  const inner = cssInRoot(el);
  const root = rootOf(el);
  if (root instanceof ShadowRoot) return `${cssFor(root.host)} ${inner}`;
  return inner;
}

export function xpathFor(el: Element): string | null {
  if (rootOf(el) instanceof ShadowRoot) return null;
  const segs: string[] = [];
  for (let cur: Element | null = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
    const id = cur.getAttribute('id');
    if (id && isStableId(id) && cur !== el) {
      segs.unshift(`//*[@id="${id.replace(/"/g, '')}"]`);
      return segs.join('/');
    }
    const isHtml = cur.namespaceURI === 'http://www.w3.org/1999/xhtml';
    const tag = isHtml ? cur.localName : `*[name()="${cur.localName}"]`;
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      segs.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.localName === cur!.localName);
    segs.unshift(same.length > 1 ? `${tag}[${same.indexOf(cur) + 1}]` : tag);
  }
  return `/${segs.join('/')}`;
}

// ── Target description ────────────────────────────────────────────────────

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describeElement(el: Element, role: string | null, name: string): string {
  const shownRole =
    role ??
    (el.localName === 'input' ? `${(el as HTMLInputElement).type || 'text'} field` : el.localName === 'select' ? 'dropdown' : el.localName);
  if (name) return `${shownRole} “${short(name)}”`;
  const ph = el.getAttribute('placeholder');
  if (ph) return `${shownRole} “${short(norm(ph))}”`;
  const nm = el.getAttribute('name');
  if (nm) return `${shownRole} [name=${short(nm, 30)}]`;
  const txt = norm(el.textContent);
  if (txt && txt.length < 60) return `${shownRole} “${short(txt)}”`;
  const id = el.getAttribute('id');
  if (id) return `${shownRole} #${short(id, 30)}`;
  const cls = Array.from(el.classList).find(isStableClass);
  return cls ? `${shownRole}.${short(cls, 30)}` : shownRole;
}

export function fingerprint(el: Element, role: string | null, name: string): ElementFingerprint {
  const fp: ElementFingerprint = { tag: el.localName };
  const set = (k: keyof ElementFingerprint, v: string | null | undefined) => {
    const s = norm(v);
    if (s) (fp as unknown as Record<string, unknown>)[k] = s.slice(0, 120);
  };
  set('id', el.getAttribute('id'));
  set('name', el.getAttribute('name'));
  set('type', el.getAttribute('type'));
  if (role) fp.role = role;
  set('label', name);
  set('placeholder', el.getAttribute('placeholder'));
  set('ariaLabel', el.getAttribute('aria-label'));
  set('title', el.getAttribute('title'));
  set('alt', el.getAttribute('alt'));
  set('href', el.getAttribute('href'));
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      fp.testId = v;
      break;
    }
  }
  if (!isTextEntry(el)) set('text', (el as HTMLElement).innerText ?? el.textContent);
  if (el.localName === 'input' && ['submit', 'button'].includes((el as HTMLInputElement).type)) set('value', (el as HTMLInputElement).value);
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 6);
  if (classes.length) fp.classes = classes;
  return fp;
}

export function buildTarget(el: Element): Target {
  const doc = el.ownerDocument;
  const role = getRole(el);
  const name = accessibleName(el, role);
  const candidates: SelectorCandidate[] = [];
  const push = (c: SelectorCandidate) => {
    if (!candidates.some((x) => x.kind === c.kind && x.value === c.value && x.name === c.name && x.nth === c.nth)) candidates.push(c);
  };
  const root = rootOf(el);

  for (const attr of TEST_ATTRS) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    const n = countCss(root, `[${attr}="${CSS.escape(v)}"]`);
    if (n === 1) push({ kind: 'testid', attr, value: v, score: 100, matches: 1 });
    else if (n > 1 && n < 20) {
      const idx = Array.from(root.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`)).indexOf(el);
      if (idx >= 0) push({ kind: 'testid', attr, value: v, nth: idx, score: 62, matches: n });
    }
    break;
  }

  if (role && name && name.length <= 100 && ROLE_SELECTOR_ROLES.has(role)) {
    const matches = countRole(doc, role, name);
    if (matches.length === 1) push({ kind: 'role', value: role, name, score: 92, matches: 1 });
    else if (matches.length > 1 && matches.length < 30) {
      const idx = matches.indexOf(el);
      if (idx >= 0) push({ kind: 'role', value: role, name, nth: idx, score: 58, matches: matches.length });
    }
  }

  if (isFormControl(el)) {
    const label = labelText(el);
    if (label && label.length <= 80) {
      const all = allDeep(doc, 'input,select,textarea').filter((e) => labelText(e) === label);
      if (all.length === 1) push({ kind: 'label', value: label, score: 88, matches: 1 });
    }
    const ph = norm(el.getAttribute('placeholder'));
    if (ph) {
      const n = allDeep(doc, '[placeholder]').filter((e) => norm(e.getAttribute('placeholder')) === ph).length;
      if (n === 1) push({ kind: 'placeholder', value: ph, score: 84, matches: 1 });
    }
  }

  const id = el.getAttribute('id');
  if (id && isStableId(id)) {
    const n = countCss(root, `#${CSS.escape(id)}`);
    if (n === 1) push({ kind: 'id', value: id, score: 86, matches: 1 });
  }

  const nm = el.getAttribute('name');
  if (nm && isFormControl(el)) {
    const sel = `${el.localName}[name="${CSS.escape(nm)}"]`;
    const n = countCss(root, sel);
    if (n === 1) push({ kind: 'name', value: nm, score: 80, matches: 1 });
  }

  const alt = norm(el.getAttribute('alt'));
  if (alt && el.localName === 'img') {
    const n = allDeep(doc, 'img[alt]').filter((e) => norm(e.getAttribute('alt')) === alt).length;
    if (n === 1) push({ kind: 'alt', value: alt, score: 76, matches: 1 });
  }

  const title = norm(el.getAttribute('title'));
  if (title && !isFormControl(el)) {
    const n = allDeep(doc, '[title]').filter((e) => norm(e.getAttribute('title')) === title).length;
    if (n === 1) push({ kind: 'title', value: title, score: 70, matches: 1 });
  }

  if (!isTextEntry(el) && el.localName !== 'select') {
    const text = ownText(el);
    if (text && text.length <= 60 && text.length >= 2) {
      const matches = countText(doc, el, text);
      if (matches.length === 1) push({ kind: 'text', value: text, score: 72, matches: 1 });
    }
  }

  const css = cssFor(el);
  if (css) {
    const n = rootOf(el) instanceof ShadowRoot ? 1 : countCss(doc, css);
    push({ kind: 'css', value: css, score: n === 1 ? 55 : 25, matches: n });
  }

  const xp = xpathFor(el);
  if (xp) push({ kind: 'xpath', value: xp, score: 30 });

  candidates.sort((a, b) => b.score - a.score);
  return {
    selectors: candidates.slice(0, 7),
    fingerprint: fingerprint(el, role, name),
    description: describeElement(el, role, name),
    role: role ?? undefined,
  };
}

// ── Field metadata for the classifier ─────────────────────────────────────

function nearbyText(el: Element): string {
  let sib = el.previousElementSibling;
  for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
    if (isFormControl(sib)) break;
    const t = norm((sib as HTMLElement).innerText ?? sib.textContent);
    if (t && t.length < 80) return t;
  }
  let parent = el.parentElement;
  for (let depth = 0; depth < 3 && parent; depth++, parent = parent.parentElement) {
    const direct = norm(
      Array.from(parent.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(' '),
    );
    if (direct && direct.length < 80) return direct;
    const prev = parent.previousElementSibling;
    if (prev && !prev.querySelector('input,select,textarea')) {
      const t = norm((prev as HTMLElement).innerText ?? prev.textContent);
      if (t && t.length < 80) return t;
    }
  }
  return '';
}

export function fieldInfo(el: Element): FieldInfo {
  const input = el as HTMLInputElement;
  const info: FieldInfo = { tag: el.localName };
  const set = <K extends keyof FieldInfo>(k: K, v: FieldInfo[K] | null | undefined | '') => {
    if (v !== null && v !== undefined && v !== '') info[k] = v as FieldInfo[K];
  };
  if (el.localName === 'input') set('type', (input.getAttribute('type') || 'text').toLowerCase());
  set('name', el.getAttribute('name'));
  set('id', el.getAttribute('id'));
  set('autocomplete', el.getAttribute('autocomplete'));
  set('placeholder', norm(el.getAttribute('placeholder')));
  set('label', labelText(el));
  set('ariaLabel', norm(el.getAttribute('aria-label')));
  set('title', norm(el.getAttribute('title')));
  if (!info.label && !info.ariaLabel) set('nearbyText', nearbyText(el));
  const db = el.getAttribute('aria-describedby');
  if (db) set('describedBy', norm(byIds(db, rootOf(el))).slice(0, 120));
  set('pattern', el.getAttribute('pattern'));
  const ml = parseInt(el.getAttribute('maxlength') ?? '', 10);
  if (ml > 0) info.maxLength = ml;
  const mn = parseInt(el.getAttribute('minlength') ?? '', 10);
  if (mn > 0) info.minLength = mn;
  set('min', el.getAttribute('min'));
  set('max', el.getAttribute('max'));
  set('step', el.getAttribute('step'));
  set('inputMode', el.getAttribute('inputmode'));
  if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') info.required = true;
  if (el.localName === 'textarea') info.multiline = true;
  if ((el as HTMLElement).isContentEditable) {
    info.contentEditable = true;
    info.multiline = true;
  }
  const form = (input.form ?? el.closest('form')) as HTMLFormElement | null;
  if (form) set('formName', form.getAttribute('name') || form.getAttribute('id') || form.getAttribute('aria-label'));
  if (el.localName === 'select') {
    info.options = Array.from((el as HTMLSelectElement).options)
      .slice(0, 300)
      .map((o) => ({ value: o.value, label: norm(o.label || o.text) }));
  }
  if (input.type === 'radio' && input.name) info.radioGroup = input.name;
  const cls = el.getAttribute('class');
  if (cls) info.className = cls.slice(0, 120);
  return info;
}
