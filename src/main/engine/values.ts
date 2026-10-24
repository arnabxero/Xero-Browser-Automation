import { generateValue, type GeneratorScope } from '../../shared/data/catalog';
import { hasTemplate, renderTemplate, type TemplateScope } from '../../shared/template';
import type { Step, ValueSource } from '../../shared/types';

export interface ValueContext {
  scope: GeneratorScope;
  vars: Record<string, string>;
  row?: Record<string, string>;
}

export function templateScope(ctx: ValueContext): TemplateScope {
  return {
    vars: ctx.vars,
    row: ctx.row,
    persona: ctx.scope.persona,
    iteration: ctx.scope.iteration,
    gen: (id) => generateValue(id, undefined, ctx.scope),
  };
}

export function render(text: string | undefined, ctx: ValueContext): string {
  if (!text) return '';
  return hasTemplate(text) ? renderTemplate(text, templateScope(ctx)) : text;
}

/** Turns a value source into the concrete text for this iteration. */
export function resolveValue(v: ValueSource | undefined, step: Step, ctx: ValueContext): string {
  let out = '';
  if (!v) return out;
  switch (v.mode) {
    case 'static':
      out = render(v.static ?? '', ctx);
      break;
    case 'random':
      out = v.dataType ? generateValue(v.dataType, v.options, ctx.scope, step.field, step.id) : '';
      break;
    case 'template':
      out = renderTemplate(v.template ?? '', templateScope(ctx));
      break;
    case 'dataset':
      out = v.column ? (ctx.row?.[v.column] ?? '') : '';
      break;
    case 'variable':
      out = v.variable ? (ctx.vars[v.variable] ?? '') : '';
      break;
  }
  if (v.saveAs) ctx.vars[v.saveAs] = out;
  return out;
}
