import { dataTypeLabel } from './data/catalog';
import type { Step, StepType, ValueSource } from './types';

export type StepGroup = 'interact' | 'input' | 'navigate' | 'wait' | 'verify' | 'data' | 'advanced';

export interface StepMeta {
  label: string;
  group: StepGroup;
  needsTarget: boolean;
  description: string;
}

export const STEP_META: Record<StepType, StepMeta> = {
  navigate: { label: 'Open URL', group: 'navigate', needsTarget: false, description: 'Load a page in the current tab' },
  click: { label: 'Click', group: 'interact', needsTarget: true, description: 'Click, double-click or right-click an element' },
  hover: { label: 'Hover', group: 'interact', needsTarget: true, description: 'Move the mouse over an element, e.g. to open a menu' },
  fill: { label: 'Type text', group: 'input', needsTarget: true, description: 'Enter text into a field' },
  press: { label: 'Press key', group: 'input', needsTarget: false, description: 'Press a key or shortcut such as Enter or Control+A' },
  select: { label: 'Choose option', group: 'input', needsTarget: true, description: 'Pick an option from a dropdown' },
  check: { label: 'Check', group: 'input', needsTarget: true, description: 'Tick a checkbox or select a radio button' },
  uncheck: { label: 'Uncheck', group: 'input', needsTarget: true, description: 'Clear a checkbox' },
  upload: { label: 'Upload files', group: 'input', needsTarget: true, description: 'Attach files to a file input' },
  dragDrop: { label: 'Drag and drop', group: 'interact', needsTarget: true, description: 'Drag one element onto another' },
  scroll: { label: 'Scroll', group: 'interact', needsTarget: false, description: 'Scroll the page or an element' },
  wait: { label: 'Wait', group: 'wait', needsTarget: false, description: 'Pause for a fixed time' },
  waitFor: { label: 'Wait for', group: 'wait', needsTarget: false, description: 'Wait until an element, URL or the network is ready' },
  assert: { label: 'Check that', group: 'verify', needsTarget: false, description: 'Fail the iteration unless a condition holds' },
  extract: { label: 'Save value', group: 'data', needsTarget: false, description: 'Read text, a value or the URL into a variable' },
  setVariable: { label: 'Set variable', group: 'data', needsTarget: false, description: 'Store a value for later steps' },
  screenshot: { label: 'Screenshot', group: 'data', needsTarget: false, description: 'Capture the page or an element' },
  script: { label: 'Run JavaScript', group: 'advanced', needsTarget: false, description: 'Run your own code in the page' },
  newTab: { label: 'New tab', group: 'navigate', needsTarget: false, description: 'Open a new tab' },
  closeTab: { label: 'Close tab', group: 'navigate', needsTarget: false, description: 'Close the current tab' },
  goBack: { label: 'Go back', group: 'navigate', needsTarget: false, description: 'Browser back button' },
  goForward: { label: 'Go forward', group: 'navigate', needsTarget: false, description: 'Browser forward button' },
  reload: { label: 'Reload', group: 'navigate', needsTarget: false, description: 'Reload the page' },
  dialog: { label: 'Answer dialog', group: 'advanced', needsTarget: false, description: 'Accept or dismiss the next alert, confirm or prompt' },
};

export const STEP_GROUPS: { id: StepGroup; label: string }[] = [
  { id: 'interact', label: 'Interact' },
  { id: 'input', label: 'Input' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'wait', label: 'Wait' },
  { id: 'verify', label: 'Verify' },
  { id: 'data', label: 'Data' },
  { id: 'advanced', label: 'Advanced' },
];

const ASSERT_LABEL: Record<string, string> = {
  text: 'text',
  visible: 'is visible',
  hidden: 'is hidden',
  value: 'value',
  url: 'URL',
  title: 'page title',
  attribute: 'attribute',
  checked: 'is checked',
  enabled: 'is enabled',
  count: 'count',
};

const OP_LABEL: Record<string, string> = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  matches: 'matches',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
};

export function shortUrl(url?: string, max = 48): string {
  if (!url) return '';
  if (/^file:/i.test(url)) {
    const name = decodeURIComponent(url.split(/[\\/]/).filter(Boolean).pop() ?? 'file');
    return /playground[\\/]index\.html$/i.test(decodeURIComponent(url)) ? 'the practice form' : `local file ${name}`;
  }
  let s = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function targetName(step: Step): string {
  return step.target?.description || 'element';
}

export function valueSummary(v?: ValueSource, mask = false): string {
  if (!v) return '';
  switch (v.mode) {
    case 'static':
      return mask ? '••••••••' : `“${(v.static ?? '').slice(0, 60)}”`;
    case 'random':
      return `Random ${dataTypeLabel(v.dataType).toLowerCase()}`;
    case 'template':
      return v.template ?? '';
    case 'dataset':
      return `Dataset column “${v.column ?? '?'}”`;
    case 'variable':
      return `Variable ${v.variable ?? '?'}`;
  }
}

export function isSecretStep(step: Step): boolean {
  return step.field?.type === 'password' || step.value?.dataType === 'internet.password';
}

export function stepTitle(step: Step): string {
  if (step.label) return step.label;
  const t = targetName(step);
  switch (step.type) {
    case 'navigate':
      return `Open ${shortUrl(step.url) || 'URL'}`;
    case 'click': {
      const verb = step.button === 'right' ? 'Right-click' : (step.clickCount ?? 1) >= 2 ? 'Double-click' : 'Click';
      return `${verb} ${t}`;
    }
    case 'hover':
      return `Hover ${t}`;
    case 'fill':
      return `Type into ${t}`;
    case 'press':
      return `Press ${step.key ?? 'key'}${step.target ? ` in ${t}` : ''}`;
    case 'select':
      return `Choose in ${t}`;
    case 'check':
      return `Check ${t}`;
    case 'uncheck':
      return `Uncheck ${t}`;
    case 'upload':
      return `Upload ${step.files?.length ?? 0} file${step.files?.length === 1 ? '' : 's'} to ${t}`;
    case 'dragDrop':
      return `Drag ${t} onto ${step.destination?.description ?? 'target'}`;
    case 'scroll':
      return step.target ? `Scroll ${t}` : `Scroll page to ${step.scroll?.y ?? 0}px`;
    case 'wait':
      return `Wait ${((step.duration ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
    case 'waitFor': {
      const k = step.waitFor?.kind;
      if (k === 'url') return `Wait for URL ${step.waitFor?.value ?? ''}`;
      if (k === 'networkIdle') return 'Wait for network to be idle';
      if (k === 'load') return 'Wait for page load';
      if (k === 'text') return `Wait for text “${step.waitFor?.value ?? ''}”`;
      return `Wait until ${t} is ${k ?? 'visible'}`;
    }
    case 'assert': {
      const a = step.assert;
      if (!a) return 'Check';
      const subject = a.kind === 'url' || a.kind === 'title' ? '' : `${t} `;
      if (['visible', 'hidden', 'checked', 'enabled'].includes(a.kind)) return `Check ${subject}${ASSERT_LABEL[a.kind]}`;
      return `Check ${subject}${ASSERT_LABEL[a.kind]} ${OP_LABEL[a.op] ?? a.op} “${a.expected ?? ''}”`;
    }
    case 'extract':
      return `Save ${step.extract?.source ?? 'text'}${step.target ? ` of ${t}` : ''} as ${step.extract?.variable ?? 'variable'}`;
    case 'setVariable':
      return `Set ${step.variable ?? 'variable'}`;
    case 'screenshot':
      return step.target && step.screenshot?.element ? `Screenshot of ${t}` : `Screenshot${step.screenshot?.fullPage ? ' (full page)' : ''}`;
    case 'script':
      return 'Run JavaScript';
    case 'newTab':
      return `Open new tab${step.url && step.url !== 'about:blank' ? ` at ${shortUrl(step.url)}` : ''}`;
    case 'closeTab':
      return 'Close tab';
    case 'goBack':
      return 'Go back';
    case 'goForward':
      return 'Go forward';
    case 'reload':
      return 'Reload page';
    case 'dialog':
      return `${step.dialog?.action === 'dismiss' ? 'Dismiss' : 'Accept'} ${step.dialog?.dialogType ?? 'dialog'}${step.dialog?.message ? ` “${step.dialog.message.slice(0, 40)}”` : ''}`;
  }
}

export function stepDetail(step: Step, mask = false): string {
  switch (step.type) {
    case 'fill':
      return valueSummary(step.value, mask && isSecretStep(step) && step.value?.mode === 'static');
    case 'select':
      if (step.value && step.value.mode !== 'static') return valueSummary(step.value);
      return step.select?.labels?.join(', ') || step.value?.static || '';
    case 'check':
    case 'uncheck':
      return step.value?.mode === 'random' ? valueSummary(step.value) : '';
    case 'press':
      return step.modifiers?.length ? step.modifiers.join('+') : '';
    case 'setVariable':
      return valueSummary(step.value);
    case 'upload':
      return (step.files ?? []).map((f) => f.split(/[\\/]/).pop()).join(', ');
    case 'script':
      return (step.code ?? '').split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))?.trim().slice(0, 80) ?? '';
    default:
      return '';
  }
}

export function isInputStep(step: Step): boolean {
  return step.type === 'fill' || step.type === 'select' || step.type === 'check' || step.type === 'uncheck';
}
