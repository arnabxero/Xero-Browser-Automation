// Injected into every frame of a live browser session. Captures user actions,
// draws the recording toolbar (top frame only) and the element highlighter.

import type { Modifier, Target } from '../shared/types';
import { camelVar } from '../shared/data/format';
import { buildTarget, editableRoot, fieldInfo, isElement, isFormControl, isTextEntry, isVisible, labelText, norm, cssFor } from './dom';
import type { PageMessage, PageState, PickMode, RecordedAction, RecorderMode } from './protocol';

declare global {
  interface Window {
    __xeroEmit?: (msg: PageMessage) => Promise<unknown>;
    __xeroInstalled?: boolean;
    __xero?: XeroPageApi;
  }
}

interface XeroPageApi {
  setState(s: Partial<PageState>): void;
  describe(el: Element): Target;
  cssFor(el: Element): string;
  flash(el: Element, label?: string, tone?: 'ok' | 'info' | 'warn'): void;
  notice(text: string): void;
}

(() => {
  if (window.__xeroInstalled) return;
  window.__xeroInstalled = true;

  const IS_TOP = window === window.top;
  const PICK_MODES = new Set<RecorderMode>(['pick', 'assertText', 'assertVisible', 'assertValue', 'extract', 'hover']);

  const state: PageState = {
    recording: false,
    paused: false,
    mode: 'idle',
    toolbar: true,
    recordScroll: false,
    recordTab: false,
    highlight: true,
    count: 0,
  };

  // ── Bridge ──────────────────────────────────────────────────────────────
  const send = (msg: PageMessage): Promise<unknown> => {
    try {
      const fn = window.__xeroEmit;
      if (typeof fn === 'function') return fn(msg).catch(() => undefined);
    } catch {
      /* binding unavailable */
    }
    return Promise.resolve(undefined);
  };

  const emitAction = (a: RecordedAction) => {
    send({ t: 'action', a, url: location.href, time: Date.now() });
  };

  let bootTries = 0;
  const boot = () => {
    if (typeof window.__xeroEmit !== 'function') {
      if (bootTries++ < 100) setTimeout(boot, 30);
      return;
    }
    send({ t: 'hello' }).then((s) => {
      if (s && typeof s === 'object') applyState(s as Partial<PageState>);
    });
  };

  const recording = () => state.recording && !state.paused && state.mode === 'record';
  const picking = () => PICK_MODES.has(state.mode);

  // ── Shadow UI (overlay + toolbar) ─────────────────────────────────────
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let box: HTMLDivElement | null = null;
  let boxLabel: HTMLDivElement | null = null;
  let bar: HTMLDivElement | null = null;
  let hint: HTMLDivElement | null = null;
  let toast: HTMLDivElement | null = null;
  let menu: HTMLDivElement | null = null;
  let toastTimer = 0;
  let timerInterval = 0;
  let barPos: { x: number; y: number } | null = null;

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
    .box { position: fixed; border: 2px solid #5B7CFA; background: rgba(91,124,250,.12); border-radius: 3px; display: none; transition: all 60ms linear; }
    .box.ok { border-color: #3CCB8A; background: rgba(60,203,138,.14); }
    .box.warn { border-color: #F2B544; background: rgba(242,181,68,.14); }
    .label { position: fixed; display: none; max-width: 420px; padding: 3px 8px; border-radius: 4px; background: #1B1F28; color: #E7E9EF; font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; height: 40px; padding: 0 6px 0 4px; border-radius: 12px; background: #1B1F28; border: 1px solid #2E3443; color: #E7E9EF; font-size: 12.5px; box-shadow: 0 10px 30px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.04) inset; pointer-events: auto; user-select: none; }
    .grip { width: 16px; height: 28px; display: grid; place-items: center; cursor: grab; color: #5D6577; }
    .grip:active { cursor: grabbing; }
    .status { display: flex; align-items: center; gap: 8px; padding: 0 10px 0 4px; height: 28px; font-variant-numeric: tabular-nums; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #FF4F5E; box-shadow: 0 0 0 0 rgba(255,79,94,.6); animation: pulse 1.6s infinite; }
    .paused .dot { background: #F2B544; animation: none; }
    .idle .dot { background: #5D6577; animation: none; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,79,94,.55); } 70% { box-shadow: 0 0 0 7px rgba(255,79,94,0); } 100% { box-shadow: 0 0 0 0 rgba(255,79,94,0); } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .time { font-weight: 600; letter-spacing: .01em; }
    .count { color: #949BAD; }
    .sep { width: 1px; height: 22px; background: #2E3443; margin: 0 4px; }
    button { all: unset; height: 30px; min-width: 30px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 8px; color: #C9CEDA; cursor: pointer; font-size: 12.5px; }
    button:hover { background: #262B36; color: #fff; }
    button:focus-visible { outline: 2px solid #5B7CFA; outline-offset: 1px; }
    button.on { background: rgba(91,124,250,.18); color: #AFC0FF; }
    button.stop { background: #FF4F5E; color: #fff; font-weight: 600; padding: 0 12px; margin-left: 2px; }
    button.stop:hover { background: #ff6573; }
    svg { width: 16px; height: 16px; flex: none; }
    .menu { position: fixed; min-width: 210px; padding: 6px; border-radius: 10px; background: #1B1F28; border: 1px solid #2E3443; box-shadow: 0 14px 40px rgba(0,0,0,.4); pointer-events: auto; display: none; }
    .menu button { display: flex; width: 100%; justify-content: flex-start; height: 32px; padding: 0 10px; }
    .menu small { color: #7C8496; margin-left: auto; padding-left: 12px; }
    .hint { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); padding: 7px 12px; border-radius: 8px; background: #5B7CFA; color: #fff; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0,0,0,.3); display: none; white-space: nowrap; }
    .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px; background: #1B1F28; border: 1px solid #2E3443; color: #C9CEDA; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.3); opacity: 0; transition: opacity 160ms ease; white-space: nowrap; max-width: 520px; overflow: hidden; text-overflow: ellipsis; }
    .toast.show { opacity: 1; }
  `;

  const ICONS: Record<string, string> = {
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
    variable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21s-4-3-4-9 4-9 4-9"/><path d="M16 3s4 3 4 9-4 9-4 9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    hover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="m6 9 6 6 6-6"/></svg>',
  };

  function ensureUi() {
    if (host && host.isConnected) return;
    if (!document.documentElement) return;
    host = document.createElement('xero-recorder-ui');
    host.setAttribute('aria-hidden', 'true');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    const layer = document.createElement('div');
    layer.className = 'layer';
    box = document.createElement('div');
    box.className = 'box';
    boxLabel = document.createElement('div');
    boxLabel.className = 'label';
    layer.append(box, boxLabel);
    if (IS_TOP) {
      bar = document.createElement('div');
      bar.className = 'bar';
      hint = document.createElement('div');
      hint.className = 'hint';
      toast = document.createElement('div');
      toast.className = 'toast';
      menu = document.createElement('div');
      menu.className = 'menu';
      layer.append(bar, hint, toast, menu);
    }
    shadow.append(style, layer);
    document.documentElement.appendChild(host);
    if (IS_TOP) renderToolbar(true);
  }

  // Keep the UI attached when single-page apps rewrite the document.
  const reattach = new MutationObserver(() => {
    if ((state.recording || picking()) && host && !host.isConnected) {
      host = null;
      ensureUi();
    }
  });

  const isOwn = (e: Event) => !!host && e.composedPath().includes(host);

  function fmtTime(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderToolbar(full = false) {
    if (!IS_TOP || !bar) return;
    const visible = state.toolbar && state.recording;
    bar.style.display = visible ? 'flex' : 'none';
    if (!visible) {
      if (menu) menu.style.display = 'none';
      return;
    }
    if (barPos) {
      bar.style.left = `${barPos.x}px`;
      bar.style.top = `${barPos.y}px`;
      bar.style.transform = 'none';
    }
    const statusCls = state.paused ? 'paused' : 'rec';
    const elapsed = state.startedAt ? fmtTime(Date.now() - state.startedAt) : '00:00';
    if (!full && bar.querySelector('.status')) {
      const st = bar.querySelector('.status') as HTMLElement;
      st.className = `status ${statusCls}`;
      (bar.querySelector('.time') as HTMLElement).textContent = state.paused ? 'Paused' : elapsed;
      (bar.querySelector('.count') as HTMLElement).textContent = `${state.count} step${state.count === 1 ? '' : 's'}`;
      const pb = bar.querySelector('[data-cmd="pause"]') as HTMLElement;
      pb.innerHTML = state.paused ? `${ICONS.play}<span>Resume</span>` : ICONS.pause;
      pb.title = state.paused ? 'Resume recording' : 'Pause recording';
      for (const b of Array.from(bar.querySelectorAll('[data-mode]'))) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.mode === state.mode);
      (bar.querySelector('[data-cmd="assertMenu"]') as HTMLElement).classList.toggle('on', ['assertText', 'assertVisible', 'assertValue'].includes(state.mode));
      return;
    }
    bar.innerHTML = `
      <div class="grip" title="Drag to move">${ICONS.grip}</div>
      <div class="status ${statusCls}"><span class="dot"></span><span class="time">${state.paused ? 'Paused' : elapsed}</span><span class="count">${state.count} steps</span></div>
      <div class="sep"></div>
      <button data-cmd="pause" title="Pause recording">${ICONS.pause}</button>
      <button data-cmd="assertMenu" title="Add a check">${ICONS.check}<span>Check</span>${ICONS.chevron}</button>
      <button data-mode="extract" title="Save an element's text as a variable">${ICONS.variable}<span>Save text</span></button>
      <button data-mode="hover" title="Record a hover (for menus that open on mouse over)">${ICONS.hover}<span>Hover</span></button>
      <button data-cmd="addWait" title="Add a 1 second wait">${ICONS.timer}</button>
      <button data-cmd="screenshot" title="Add a screenshot step">${ICONS.camera}</button>
      <button class="stop" data-cmd="stop" title="Stop recording">${ICONS.stop}<span>Stop</span></button>`;
    bar.onclick = onBarClick;
    const grip = bar.querySelector('.grip') as HTMLElement;
    grip.onpointerdown = startDrag;
    renderToolbar(false);
  }

  function onBarClick(e: MouseEvent) {
    const btn = (e.target as Element).closest('button') as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const cmd = btn.dataset.cmd;
    const mode = btn.dataset.mode as PickMode | undefined;
    if (mode) {
      setMode(state.mode === mode ? 'record' : mode);
      return;
    }
    switch (cmd) {
      case 'pause':
        send({ t: 'cmd', cmd: state.paused ? 'resume' : 'pause' });
        state.paused = !state.paused;
        renderToolbar();
        break;
      case 'assertMenu':
        toggleMenu(btn);
        break;
      case 'addWait':
        send({ t: 'cmd', cmd: 'addWait' });
        showToast('Added a 1 s wait');
        renderToolbar();
        break;
      case 'screenshot':
        send({ t: 'cmd', cmd: 'screenshot' });
        showToast('Added a screenshot step');
        renderToolbar();
        break;
      case 'stop':
        send({ t: 'cmd', cmd: 'stop' });
        break;
    }
  }

  function toggleMenu(anchor: HTMLElement) {
    if (!menu) return;
    if (menu.style.display === 'block') {
      menu.style.display = 'none';
      return;
    }
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 6}px`;
    menu.innerHTML = `
      <button data-m="assertText">Text of an element<small>contains</small></button>
      <button data-m="assertVisible">Element is visible</button>
      <button data-m="assertValue">Field value</button>
      <button data-c="assertUrl">Page URL<small>current</small></button>
      <button data-c="assertTitle">Page title<small>current</small></button>`;
    menu.style.display = 'block';
    menu.onclick = (e) => {
      const b = (e.target as Element).closest('button') as HTMLElement | null;
      if (!b) return;
      e.stopPropagation();
      menu!.style.display = 'none';
      if (b.dataset.m) setMode(b.dataset.m as PickMode);
      if (b.dataset.c) {
        send({ t: 'cmd', cmd: b.dataset.c as 'assertUrl' | 'assertTitle' });
        showToast(b.dataset.c === 'assertUrl' ? 'Added a check for the page URL' : 'Added a check for the page title');
        renderToolbar();
      }
    };
  }

  function startDrag(e: PointerEvent) {
    if (!bar) return;
    e.preventDefault();
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => {
      barPos = {
        x: Math.max(4, Math.min(window.innerWidth - r.width - 4, ev.clientX - dx)),
        y: Math.max(4, Math.min(window.innerHeight - r.height - 4, ev.clientY - dy)),
      };
      renderToolbar();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  const MODE_HINTS: Record<string, string> = {
    pick: 'Click the element you want to use · Esc to cancel',
    assertText: 'Click an element to check its text · Esc to cancel',
    assertVisible: 'Click an element that must be visible · Esc to cancel',
    assertValue: 'Click a field to check its value · Esc to cancel',
    extract: 'Click an element to save its text as a variable · Esc to cancel',
    hover: 'Click the element to hover over · Esc to cancel',
  };

  function setMode(mode: RecorderMode) {
    state.mode = mode;
    send({ t: 'cmd', cmd: 'setMode', mode });
    syncMode();
  }

  function syncMode() {
    ensureUi();
    if (hint) {
      const h = MODE_HINTS[state.mode];
      hint.textContent = h ?? '';
      hint.style.display = h && IS_TOP ? 'block' : 'none';
    }
    if (!picking()) hideBox();
    if (menu && picking()) menu.style.display = 'none';
    renderToolbar();
  }

  function showToast(text: string) {
    if (!toast || !IS_TOP) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast?.classList.remove('show'), 1800);
  }

  function drawBox(el: Element, label?: string, tone: 'ok' | 'info' | 'warn' = 'info') {
    ensureUi();
    if (!box || !boxLabel) return;
    const r = el.getBoundingClientRect();
    box.className = `box${tone === 'ok' ? ' ok' : tone === 'warn' ? ' warn' : ''}`;
    box.style.display = 'block';
    box.style.left = `${r.left - 2}px`;
    box.style.top = `${r.top - 2}px`;
    box.style.width = `${r.width + 4}px`;
    box.style.height = `${r.height + 4}px`;
    if (label) {
      boxLabel.textContent = label;
      boxLabel.style.display = 'block';
      const top = r.top > 28 ? r.top - 26 : r.bottom + 6;
      boxLabel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 300))}px`;
      boxLabel.style.top = `${top}px`;
    } else boxLabel.style.display = 'none';
  }

  function hideBox() {
    if (box) box.style.display = 'none';
    if (boxLabel) boxLabel.style.display = 'none';
  }

  let flashTimer = 0;
  function flash(el: Element, label?: string, tone: 'ok' | 'info' | 'warn' = 'ok') {
    drawBox(el, label, tone);
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      if (!picking()) hideBox();
    }, 900);
  }

  function applyState(s: Partial<PageState>) {
    const wasRecording = state.recording;
    Object.assign(state, s);
    if (state.recording || picking()) ensureUi();
    if (state.recording && !wasRecording) {
      clearInterval(timerInterval);
      timerInterval = window.setInterval(() => renderToolbar(), 1000);
      try {
        reattach.observe(document.documentElement, { childList: true });
      } catch {
        /* no document yet */
      }
    }
    if (!state.recording) clearInterval(timerInterval);
    syncMode();
  }

  // ── Event capture helpers ─────────────────────────────────────────────
  const deepTarget = (e: Event): Element | null => {
    const path = e.composedPath();
    for (const n of path) if (isElement(n)) return n;
    return isElement(e.target) ? e.target : null;
  };

  const INTERACTIVE =
    'button, a[href], input, select, textarea, label, summary, [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=checkbox], [role=radio], [role=option], [role=switch], [role=treeitem], [role=gridcell], [contenteditable=""], [contenteditable=true], [onclick]';

  function retarget(el: Element): Element {
    let cur: Element | null = el;
    // Walk up through shadow boundaries as well.
    for (let i = 0; cur && i < 12; i++) {
      if (cur.matches?.(INTERACTIVE)) return cur;
      const parent: Element | null = cur.parentElement ?? ((cur.getRootNode() as ShadowRoot).host ?? null);
      cur = parent;
    }
    return el;
  }

  const modifiersOf = (e: KeyboardEvent | MouseEvent): Modifier[] => {
    const m: Modifier[] = [];
    if (e.altKey) m.push('Alt');
    if (e.ctrlKey) m.push('Control');
    if (e.metaKey) m.push('Meta');
    if (e.shiftKey) m.push('Shift');
    return m;
  };

  const describeCache = new WeakMap<Element, { t: number; target: Target }>();
  function describe(el: Element, cacheMs = 0): Target {
    if (cacheMs) {
      const c = describeCache.get(el);
      if (c && Date.now() - c.t < cacheMs) return c.target;
    }
    const target = buildTarget(el);
    describeCache.set(el, { t: Date.now(), target });
    return target;
  }

  const announce = (el: Element, text: string) => {
    if (state.highlight) flash(el, text, 'ok');
    if (IS_TOP) showToast(text);
  };

  // ── Click ─────────────────────────────────────────────────────────────
  let suppressClickUntil = 0;
  let lastTextEnterAt = 0;
  let html5Source: Element | null = null;
  let down: { el: Element; x: number; y: number; t: number } | null = null;

  function blockIfPicking(e: Event) {
    if (!picking() || isOwn(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'submit', 'touchstart']) {
    window.addEventListener(type, blockIfPicking, true);
  }

  window.addEventListener(
    'click',
    (e) => {
      if (isOwn(e)) return;
      if (picking()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handlePick(e);
        return;
      }
      if (!recording() || !e.isTrusted) return;
      if (Date.now() < suppressClickUntil) return;
      // Enter in a text field submits the form with a synthetic click (detail 0); the Enter press is already recorded.
      if (e.detail === 0 && Date.now() - lastTextEnterAt < 600) return;
      const raw = deepTarget(e);
      if (!raw) return;
      const el = retarget(raw);
      const tag = el.localName;
      if (tag === 'select' || tag === 'option') return;
      if (tag === 'input') {
        const t = (el as HTMLInputElement).type;
        if (t === 'checkbox' || t === 'radio' || t === 'file') return;
      }
      if (tag === 'label') {
        const control = (el as HTMLLabelElement).control;
        if (control) {
          const ct = (control as HTMLInputElement).type;
          // Visible boxes get their own change event; hidden custom ones are handled there too.
          if (ct === 'checkbox' || ct === 'radio' || ct === 'file') return;
          if (isTextEntry(control)) return;
        }
      }
      const target = describe(el);
      let position: { x: number; y: number } | undefined;
      if (tag === 'canvas' || tag === 'video' || tag === 'img' || tag === 'svg' || tag === 'area') {
        const r = el.getBoundingClientRect();
        position = { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
      }
      emitAction({ kind: 'click', target, button: 'left', clickCount: Math.min(e.detail || 1, 3), modifiers: modifiersOf(e), position, textEntry: isTextEntry(el) });
      announce(el, `${e.detail >= 2 ? 'Double-click' : 'Click'} ${target.description}`);
    },
    true,
  );

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (isOwn(e) || !recording() || !e.isTrusted) return;
      const raw = deepTarget(e);
      if (!raw) return;
      const el = retarget(raw);
      const target = describe(el);
      emitAction({ kind: 'click', target, button: 'right', clickCount: 1, modifiers: modifiersOf(e) });
      announce(el, `Right-click ${target.description}`);
    },
    true,
  );

  window.addEventListener(
    'auxclick',
    (e) => {
      if (isOwn(e) || !recording() || !e.isTrusted || e.button !== 1) return;
      const raw = deepTarget(e);
      if (!raw) return;
      const el = retarget(raw);
      const target = describe(el);
      emitAction({ kind: 'click', target, button: 'middle', clickCount: 1, modifiers: modifiersOf(e) });
    },
    true,
  );

  // ── Drag and drop ─────────────────────────────────────────────────────
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (isOwn(e) || !recording() || !e.isTrusted || e.button !== 0) return;
      const el = deepTarget(e);
      if (!el) return;
      if (e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight) return;
      down = { el, x: e.clientX, y: e.clientY, t: Date.now() };
    },
    true,
  );

  window.addEventListener(
    'pointerup',
    (e) => {
      const start = down;
      down = null;
      if (!start || isOwn(e) || !recording() || !e.isTrusted) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist < 14 || Date.now() - start.t < 120) return;
      if (isTextEntry(start.el) || start.el.localName === 'input' || start.el.localName === 'select') return;
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (!under) return;
      const src = retarget(start.el);
      const dst = retarget(under);
      if (src === dst && (src === document.documentElement || src === document.body)) return;
      emitAction({ kind: 'dragDrop', target: describe(src), destination: describe(dst) });
      suppressClickUntil = Date.now() + 350;
      announce(dst, `Drag onto ${describe(dst, 1000).description}`);
    },
    true,
  );

  window.addEventListener(
    'dragstart',
    (e) => {
      if (isOwn(e) || !recording()) return;
      const el = deepTarget(e);
      html5Source = el ? retarget(el) : null;
      down = null;
    },
    true,
  );

  window.addEventListener(
    'drop',
    (e) => {
      if (isOwn(e) || !recording() || !html5Source) return;
      const el = deepTarget(e);
      if (!el) return;
      const dst = retarget(el);
      emitAction({ kind: 'dragDrop', target: describe(html5Source), destination: describe(dst) });
      announce(dst, `Drop onto ${describe(dst, 1000).description}`);
      html5Source = null;
      suppressClickUntil = Date.now() + 350;
    },
    true,
  );
  window.addEventListener('dragend', () => (html5Source = null), true);

  // ── Typing ────────────────────────────────────────────────────────────
  function readValue(el: Element): string {
    if (el.localName === 'input' || el.localName === 'textarea') return (el as HTMLInputElement).value;
    return (el as HTMLElement).innerText ?? el.textContent ?? '';
  }

  let lastFillToast = 0;
  const lastFilled = new WeakMap<Element, string>();
  function recordFill(el: Element, onlyIfChanged = false) {
    const root = editableRoot(el);
    const value = readValue(root);
    // A blur fires "change" with the value we already recorded from "input".
    if (onlyIfChanged && lastFilled.get(root) === value) return;
    lastFilled.set(root, value);
    const target = describe(root, 5000);
    emitAction({ kind: 'fill', target, value, field: fieldInfo(root) });
    if (Date.now() - lastFillToast > 1200) {
      lastFillToast = Date.now();
      if (IS_TOP) showToast(`Typing into ${target.description}`);
    }
  }

  window.addEventListener(
    'input',
    (e) => {
      if (isOwn(e) || !recording()) return;
      const el = deepTarget(e);
      if (!el) return;
      if (isTextEntry(el) || (el as HTMLElement).isContentEditable) {
        recordFill(el);
        return;
      }
      if (el.localName === 'input' && ['range', 'color'].includes((el as HTMLInputElement).type)) {
        const target = describe(el, 5000);
        emitAction({ kind: 'fill', target, value: (el as HTMLInputElement).value, field: fieldInfo(el) });
      }
    },
    true,
  );

  window.addEventListener(
    'change',
    (e) => {
      if (isOwn(e) || !recording()) return;
      const el = deepTarget(e);
      if (!el) return;
      if (el.localName === 'select') {
        const sel = el as HTMLSelectElement;
        const opts = Array.from(sel.selectedOptions);
        const target = describe(el);
        emitAction({ kind: 'select', target, values: opts.map((o) => o.value), labels: opts.map((o) => norm(o.label || o.text)), field: fieldInfo(el) });
        announce(el, `Choose “${opts.map((o) => norm(o.label || o.text)).join(', ')}”`);
        return;
      }
      if (el.localName === 'input') {
        const input = el as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          if (isVisible(input)) {
            const target = describe(input);
            emitAction({ kind: input.checked ? 'check' : 'uncheck', target, field: fieldInfo(input) });
            announce(input, `${input.checked ? 'Check' : 'Uncheck'} ${target.description}`);
          } else {
            // Custom control with a hidden native input: replay as a click on its label.
            const label = input.labels?.[0] ?? input.closest('label') ?? input.parentElement;
            if (label) {
              const target = describe(label);
              emitAction({ kind: 'click', target, button: 'left', clickCount: 1, modifiers: [] });
              announce(label, `Click ${target.description}`);
            }
          }
          return;
        }
        if (input.type === 'file') return;
      }
      if (isTextEntry(el)) recordFill(el, true);
    },
    true,
  );

  // ── Keys ──────────────────────────────────────────────────────────────
  const NAV_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Delete', 'Backspace']);
  const EDIT_SHORTCUTS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

  window.addEventListener(
    'keydown',
    (e) => {
      if (isOwn(e)) return;
      if (picking() && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        send({ t: 'cmd', cmd: 'cancelPick' });
        state.mode = state.recording ? 'record' : 'idle';
        syncMode();
        return;
      }
      if (!recording() || !e.isTrusted || e.repeat) return;
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Process', 'Unidentified'].includes(e.key)) return;
      // AltGr reports Control+Alt on Windows; it types characters such as € or ą, which the fill step captures.
      if (e.getModifierState?.('AltGraph')) return;
      const el = deepTarget(e);
      const active = el && el !== document.body && el !== document.documentElement ? el : null;
      const inText = !!active && (isTextEntry(active) || (active as HTMLElement).isContentEditable);
      const mods = modifiersOf(e);
      const hasCmd = mods.includes('Control') || mods.includes('Meta') || mods.includes('Alt');
      let record = false;
      if (hasCmd) record = !(inText && EDIT_SHORTCUTS.has(e.key.toLowerCase()));
      else if (e.key === 'Tab') record = state.recordTab;
      else if (inText) {
        const combo = active && (active.getAttribute('role') === 'combobox' || active.hasAttribute('aria-autocomplete') || active.hasAttribute('list') || active.getAttribute('aria-expanded') === 'true');
        // Enter inside a textarea or rich editor is part of the text itself.
        const multiline = !!active && (active.localName === 'textarea' || (active as HTMLElement).isContentEditable);
        record = (e.key === 'Enter' && !multiline) || e.key === 'Escape' || (!!combo && (e.key === 'ArrowDown' || e.key === 'ArrowUp'));
      } else if (NAV_KEYS.has(e.key) || /^F\d{1,2}$/.test(e.key)) {
        // Enter/Space on a focused button fire a click, which is recorded already.
        record = !(active && (e.key === 'Enter' || e.key === ' ') && active.matches('button, a[href], [role=button], [role=link], input[type=submit], input[type=button]'));
      } else if (e.key.length === 1 && e.key !== ' ') record = true;
      if (!record) return;
      // Shift is implied by an upper-case letter unless another modifier is held (Control+Shift+K).
      const key = [...mods.filter((m) => !(m === 'Shift' && e.key.length === 1 && !hasCmd)), e.key === ' ' ? 'Space' : e.key].join('+');
      if (e.key === 'Enter' && inText) lastTextEnterAt = Date.now();
      const target = active ? describe(editableRoot(active), 3000) : undefined;
      emitAction({ kind: 'press', target, key, modifiers: [] });
      if (IS_TOP) showToast(`Press ${key}`);
    },
    true,
  );

  // ── Scroll ────────────────────────────────────────────────────────────
  let scrollTimer = 0;
  let scrollEl: Element | null = null;
  window.addEventListener(
    'scroll',
    (e) => {
      if (!recording() || !state.recordScroll) return;
      const t = e.target;
      scrollEl = t === document || t === window ? null : isElement(t) ? t : null;
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        if (!recording()) return;
        if (scrollEl && scrollEl !== document.scrollingElement) {
          emitAction({ kind: 'scroll', target: describe(scrollEl), x: Math.round(scrollEl.scrollLeft), y: Math.round(scrollEl.scrollTop) });
        } else {
          emitAction({ kind: 'scroll', x: Math.round(window.scrollX), y: Math.round(window.scrollY) });
        }
      }, 450);
    },
    { capture: true, passive: true },
  );

  // ── Picking (assertions, extraction, hover, re-targeting) ─────────────
  let pickRaf = 0;
  let lastHover: Element | null = null;
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!picking() || isOwn(e)) return;
      const el = deepTarget(e);
      if (!el || el === lastHover) return;
      lastHover = el;
      cancelAnimationFrame(pickRaf);
      pickRaf = requestAnimationFrame(() => {
        const t = pickTarget(el);
        drawBox(t, describe(t, 2000).description, 'info');
      });
    },
    true,
  );

  function pickTarget(el: Element): Element {
    if (state.mode === 'assertText' || state.mode === 'extract') {
      // Prefer the smallest element that still has meaningful text.
      if (norm(el.textContent).length === 0 && el.parentElement) return el.parentElement;
      return el;
    }
    if (state.mode === 'assertValue') {
      const control = el.closest('input,select,textarea');
      return control ?? el;
    }
    return retarget(el);
  }

  function handlePick(e: MouseEvent) {
    const raw = deepTarget(e);
    if (!raw) return;
    const el = pickTarget(raw);
    const target = describe(el);
    const mode = state.mode;
    const back: RecorderMode = state.recording ? 'record' : 'idle';
    switch (mode) {
      case 'pick':
        send({ t: 'picked', target });
        flash(el, `Selected ${target.description}`, 'ok');
        break;
      case 'assertText': {
        const text = norm((el as HTMLElement).innerText ?? el.textContent).slice(0, 200);
        emitAction({ kind: 'assert', target, assert: { kind: 'text', op: 'contains', expected: text } });
        announce(el, `Check text “${text.slice(0, 40)}”`);
        break;
      }
      case 'assertVisible':
        emitAction({ kind: 'assert', target, assert: { kind: 'visible', op: 'equals' } });
        announce(el, `Check ${target.description} is visible`);
        break;
      case 'assertValue': {
        const value = isFormControl(el) ? (el as HTMLInputElement).value : norm(el.textContent);
        emitAction({ kind: 'assert', target, assert: { kind: 'value', op: 'equals', expected: value } });
        announce(el, `Check value “${value.slice(0, 40)}”`);
        break;
      }
      case 'extract': {
        const isControl = isFormControl(el);
        const base = (isControl ? labelText(el) : '') || el.getAttribute('aria-label') || norm((el as HTMLElement).innerText ?? el.textContent).slice(0, 30) || 'value';
        emitAction({ kind: 'extract', target, source: isControl ? 'value' : 'text', variable: camelVar(base) });
        announce(el, `Save ${isControl ? 'value' : 'text'} of ${target.description}`);
        break;
      }
      case 'hover':
        emitAction({ kind: 'hover', target });
        announce(el, `Hover ${target.description}`);
        break;
    }
    state.mode = back;
    send({ t: 'cmd', cmd: 'setMode', mode: back });
    syncMode();
  }

  // ── API for the main process ──────────────────────────────────────────
  window.__xero = {
    setState: applyState,
    describe: (el: Element) => buildTarget(el),
    cssFor: (el: Element) => cssFor(el),
    flash: (el: Element, label?: string, tone?: 'ok' | 'info' | 'warn') => {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      } catch {
        /* detached */
      }
      requestAnimationFrame(() => flash(el, label, tone ?? 'info'));
      setTimeout(() => hideBox(), 1600);
    },
    notice: (text: string) => showToast(text),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => (state.recording || picking() ? ensureUi() : undefined), { once: true });
  boot();
})();
