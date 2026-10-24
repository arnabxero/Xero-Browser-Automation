import { formatDate, slugify } from './data/format';
import type { Persona } from './data/persona';

export interface TemplateScope {
  vars: Record<string, string>;
  row?: Record<string, string>;
  persona?: () => Persona;
  /** 1-based iteration number. */
  iteration: number;
  /** Generates a value for a data type id, e.g. `random.internet.email`. */
  gen?: (dataType: string) => string;
}

const EXPR = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function hasTemplate(s?: string): boolean {
  return !!s && /\{\{[^{}]+\}\}/.test(s);
}

function applyFilter(value: string, filter: string): string {
  const [name, ...args] = filter.split(':');
  switch (name.trim().toLowerCase()) {
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'trim':
      return value.trim();
    case 'slug':
      return slugify(value);
    case 'capitalize':
      return value.charAt(0).toUpperCase() + value.slice(1);
    case 'pad':
      return value.padStart(parseInt(args[0] ?? '2', 10) || 2, args[1] ?? '0');
    case 'slice':
      return value.slice(parseInt(args[0] ?? '0', 10) || 0, args[1] !== undefined ? parseInt(args[1], 10) : undefined);
    case 'replace':
      return value.split(args[0] ?? '').join(args[1] ?? '');
    case 'default':
      return value || args.join(':');
    case 'date': {
      const d = /^\d+$/.test(value) ? new Date(parseInt(value, 10)) : new Date(value);
      return Number.isNaN(d.getTime()) ? value : formatDate(d, args.join(':') || 'YYYY-MM-DD');
    }
    case 'digits':
      return value.replace(/\D/g, '');
    default:
      return value;
  }
}

function resolve(expr: string, scope: TemplateScope): string | undefined {
  const e = expr.trim();
  if (e === 'iteration') return String(scope.iteration);
  if (e === 'index') return String(scope.iteration - 1);
  if (e === 'timestamp') return String(Date.now());
  if (e === 'now' || e === 'today') return new Date().toISOString();
  if (e === 'uuid') return crypto.randomUUID();
  if (e.startsWith('int:')) {
    const [, a, b] = e.split(':');
    const min = parseInt(a ?? '0', 10) || 0;
    const max = parseInt(b ?? '100', 10) || 100;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }
  if (e.startsWith('pick:')) {
    const items = e.slice(5).split(',').map((s) => s.trim()).filter(Boolean);
    return items.length ? items[Math.floor(Math.random() * items.length)] : '';
  }
  if (e.startsWith('random.')) return scope.gen?.(e.slice(7)) ?? '';
  const dot = e.indexOf('.');
  if (dot > 0) {
    const ns = e.slice(0, dot);
    const key = e.slice(dot + 1);
    if (ns === 'var' || ns === 'vars') return scope.vars[key] ?? '';
    if (ns === 'data' || ns === 'row') return scope.row?.[key] ?? '';
    if (ns === 'persona' && scope.persona) {
      const p = scope.persona() as unknown as Record<string, unknown>;
      const v = p[key];
      if (v instanceof Date) return formatDate(v, 'YYYY-MM-DD');
      return v === undefined ? '' : String(v);
    }
  }
  if (e in scope.vars) return scope.vars[e];
  if (scope.row && e in scope.row) return scope.row[e];
  return undefined;
}

export function renderTemplate(tpl: string | undefined, scope: TemplateScope): string {
  if (!tpl) return '';
  return tpl.replace(EXPR, (whole, inner: string) => {
    const [expr, ...filters] = splitPipes(inner);
    let value = resolve(expr, scope);
    if (value === undefined) return whole;
    for (const f of filters) value = applyFilter(value, f);
    return value;
  });
}

function splitPipes(s: string): string[] {
  // `pick:` lists use commas, so a plain split on "|" is safe.
  return s.split('|').map((p) => p.trim());
}

/** Lists the placeholders a template references, for validation hints in the editor. */
export function templateRefs(tpl?: string): string[] {
  if (!tpl) return [];
  const out: string[] = [];
  for (const m of tpl.matchAll(EXPR)) out.push(splitPipes(m[1])[0]);
  return out;
}

export const TEMPLATE_HELP: { token: string; description: string }[] = [
  { token: '{{var.name}}', description: 'A flow variable or a value saved by an earlier step' },
  { token: '{{data.Column}}', description: 'A column of the dataset row used by this iteration' },
  { token: '{{persona.email}}', description: 'The generated person for this iteration (firstName, lastName, email, phone, city…)' },
  { token: '{{random.internet.email}}', description: 'A fresh value from any data type' },
  { token: '{{iteration}}', description: 'Iteration number, starting at 1' },
  { token: '{{int:1:100}}', description: 'Random whole number in a range' },
  { token: '{{pick:red,green,blue}}', description: 'Random item from a list' },
  { token: '{{timestamp}}', description: 'Milliseconds since 1970' },
  { token: '{{uuid}}', description: 'Random UUID' },
  { token: '{{now | date:DD/MM/YYYY}}', description: 'Current date in any format' },
  { token: '{{persona.firstName | lower}}', description: 'Filters: lower, upper, trim, slug, capitalize, pad:4, slice:0:3, digits, default:x' },
];
