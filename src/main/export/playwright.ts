import { getDataType } from '../../shared/data/catalog';
import type { Flow, SelectorCandidate, Step, Target, ValueSource } from '../../shared/types';

const q = (s: string) => JSON.stringify(s);

function locatorCode(target: Target | undefined, page: string): string {
  if (!target) return `${page}.locator('body')`;
  let scope = page;
  for (const f of target.framePath ?? []) scope = `${scope}.frameLocator(${q(f.selector)})`;
  const c: SelectorCandidate | undefined = target.selectors[0];
  if (!c) return `${scope}.locator('body')`;
  let expr: string;
  switch (c.kind) {
    case 'testid':
      expr = c.attr === 'data-testid' || !c.attr ? `${scope}.getByTestId(${q(c.value)})` : `${scope}.locator(${q(`[${c.attr}="${c.value}"]`)})`;
      break;
    case 'role':
      expr = `${scope}.getByRole(${q(c.value)}${c.name ? `, { name: ${q(c.name)}, exact: true }` : ''})`;
      break;
    case 'label':
      expr = `${scope}.getByLabel(${q(c.value)}, { exact: true })`;
      break;
    case 'placeholder':
      expr = `${scope}.getByPlaceholder(${q(c.value)}, { exact: true })`;
      break;
    case 'text':
      expr = `${scope}.getByText(${q(c.value)}, { exact: true })`;
      break;
    case 'alt':
      expr = `${scope}.getByAltText(${q(c.value)}, { exact: true })`;
      break;
    case 'title':
      expr = `${scope}.getByTitle(${q(c.value)}, { exact: true })`;
      break;
    case 'id':
      expr = `${scope}.locator(${q(`[id="${c.value}"]`)})`;
      break;
    case 'name':
      expr = `${scope}.locator(${q(`[name="${c.value}"]`)})`;
      break;
    case 'xpath':
      expr = `${scope}.locator(${q(`xpath=${c.value}`)})`;
      break;
    default:
      expr = `${scope}.locator(${q(c.value)})`;
  }
  return c.nth !== undefined ? `${expr}.nth(${c.nth})` : expr;
}

const FAKER_MAP: Record<string, string> = {
  'person.fullName': 'faker.person.fullName()',
  'person.firstName': 'faker.person.firstName()',
  'person.lastName': 'faker.person.lastName()',
  'person.middleName': 'faker.person.middleName()',
  'person.jobTitle': 'faker.person.jobTitle()',
  'person.bio': 'faker.person.bio()',
  'internet.email': 'faker.internet.email()',
  'internet.username': 'faker.internet.username()',
  'internet.password': "faker.internet.password({ length: 14 }) + 'A1!'",
  'phone.number': 'faker.phone.number()',
  'address.street': 'faker.location.streetAddress()',
  'address.secondary': 'faker.location.secondaryAddress()',
  'address.city': 'faker.location.city()',
  'address.state': 'faker.location.state()',
  'address.stateAbbr': 'faker.location.state({ abbreviated: true })',
  'address.zip': 'faker.location.zipCode()',
  'address.country': 'faker.location.country()',
  'address.countryCode': 'faker.location.countryCode()',
  'company.name': 'faker.company.name()',
  'company.catchPhrase': 'faker.company.catchPhrase()',
  'company.website': 'faker.internet.url()',
  'finance.creditCard': "'4242424242424242'",
  'finance.cvv': 'faker.finance.creditCardCVV()',
  'finance.iban': 'faker.finance.iban()',
  'finance.amount': 'faker.finance.amount()',
  'text.word': 'faker.word.sample()',
  'text.words': 'faker.word.words(3)',
  'text.sentence': 'faker.lorem.sentence()',
  'text.paragraph': 'faker.lorem.paragraph()',
  'number.int': 'String(faker.number.int({ min: 1, max: 100 }))',
  'id.uuid': 'faker.string.uuid()',
  'id.alphanumeric': 'faker.string.alphanumeric(8)',
  'id.otp': 'faker.string.numeric(6)',
  'web.url': 'faker.internet.url()',
  'commerce.product': 'faker.commerce.productName()',
  'commerce.price': 'faker.commerce.price()',
};

function valueCode(v: ValueSource | undefined, usesFaker: { on: boolean }): string {
  if (!v) return "''";
  switch (v.mode) {
    case 'random': {
      const code = v.dataType ? FAKER_MAP[v.dataType] : undefined;
      if (code) {
        usesFaker.on = true;
        return code;
      }
      return `${q(v.static ?? '')} /* random ${getDataType(v.dataType)?.label ?? v.dataType} */`;
    }
    case 'variable':
      return `vars[${q(v.variable ?? '')}] ?? ''`;
    case 'dataset':
      return `row[${q(v.column ?? '')}] ?? ''`;
    case 'template':
      return `${q(v.template ?? '')} /* template */`;
    default:
      return q(v.static ?? '');
  }
}

function stepCode(step: Step, usesFaker: { on: boolean }): string[] {
  const page = step.tab ? `pages[${step.tab}]` : 'page';
  const loc = () => locatorCode(step.target, page);
  const lines: string[] = [];
  const comment = step.note ? [`// ${step.note.replace(/\n/g, ' ')}`] : [];
  switch (step.type) {
    case 'navigate':
      lines.push(`await ${page}.goto(${q(step.url ?? '')});`);
      break;
    case 'click': {
      const opts: string[] = [];
      if (step.button && step.button !== 'left') opts.push(`button: ${q(step.button)}`);
      if (step.modifiers?.length) opts.push(`modifiers: ${JSON.stringify(step.modifiers)}`);
      if (step.position) opts.push(`position: { x: ${step.position.x}, y: ${step.position.y} }`);
      const o = opts.length ? `{ ${opts.join(', ')} }` : '';
      lines.push((step.clickCount ?? 1) >= 2 ? `await ${loc()}.dblclick(${o});` : `await ${loc()}.click(${o});`);
      break;
    }
    case 'hover':
      lines.push(`await ${loc()}.hover();`);
      break;
    case 'fill':
      lines.push(`await ${loc()}.fill(${valueCode(step.value, usesFaker)});`);
      break;
    case 'press':
      lines.push(step.target ? `await ${loc()}.press(${q(step.key ?? 'Enter')});` : `await ${page}.keyboard.press(${q(step.key ?? 'Enter')});`);
      break;
    case 'select':
      lines.push(`await ${loc()}.selectOption(${JSON.stringify(step.select?.values ?? [step.value?.static ?? ''])});`);
      break;
    case 'check':
      lines.push(`await ${loc()}.check();`);
      break;
    case 'uncheck':
      lines.push(`await ${loc()}.uncheck();`);
      break;
    case 'upload':
      lines.push(`await ${loc()}.setInputFiles(${JSON.stringify(step.files ?? [])});`);
      break;
    case 'dragDrop':
      lines.push(`await ${loc()}.dragTo(${locatorCode(step.destination, page)});`);
      break;
    case 'scroll':
      lines.push(step.target ? `await ${loc()}.evaluate((el) => el.scrollTo(${step.scroll?.x ?? 0}, ${step.scroll?.y ?? 0}));` : `await ${page}.evaluate(() => window.scrollTo(${step.scroll?.x ?? 0}, ${step.scroll?.y ?? 0}));`);
      break;
    case 'wait':
      lines.push(`await ${page}.waitForTimeout(${step.duration ?? 1000});`);
      break;
    case 'waitFor': {
      const w = step.waitFor;
      if (w?.kind === 'url') lines.push(`await ${page}.waitForURL(${q(`**${w.value ?? ''}**`)});`);
      else if (w?.kind === 'networkIdle') lines.push(`await ${page}.waitForLoadState('networkidle');`);
      else if (w?.kind === 'load') lines.push(`await ${page}.waitForLoadState('load');`);
      else if (w?.kind === 'text') lines.push(`await ${page}.getByText(${q(w.value ?? '')}).first().waitFor();`);
      else lines.push(`await ${loc()}.waitFor({ state: ${q(w?.kind ?? 'visible')} });`);
      break;
    }
    case 'assert': {
      const a = step.assert;
      const exp = q(a?.expected ?? '');
      switch (a?.kind) {
        case 'url':
          lines.push(a.op === 'equals' ? `await expect(${page}).toHaveURL(${exp});` : `expect(${page}.url()).toContain(${exp});`);
          break;
        case 'title':
          lines.push(`await expect(${page}).toHaveTitle(${exp});`);
          break;
        case 'visible':
          lines.push(`await expect(${loc()}).toBeVisible();`);
          break;
        case 'hidden':
          lines.push(`await expect(${loc()}).toBeHidden();`);
          break;
        case 'value':
          lines.push(`await expect(${loc()}).toHaveValue(${exp});`);
          break;
        case 'checked':
          lines.push(`await expect(${loc()}).toBeChecked();`);
          break;
        case 'enabled':
          lines.push(`await expect(${loc()}).toBeEnabled();`);
          break;
        case 'attribute':
          lines.push(`await expect(${loc()}).toHaveAttribute(${q(a.attribute ?? 'class')}, ${exp});`);
          break;
        case 'count':
          lines.push(`await expect(${loc()}).toHaveCount(${parseInt(a.expected ?? '0', 10) || 0});`);
          break;
        default:
          lines.push(a?.op === 'equals' ? `await expect(${loc()}).toHaveText(${exp});` : `await expect(${loc()}).toContainText(${exp});`);
      }
      break;
    }
    case 'extract': {
      const ex = step.extract;
      const name = q(ex?.variable ?? 'value');
      if (ex?.source === 'url') lines.push(`vars[${name}] = ${page}.url();`);
      else if (ex?.source === 'title') lines.push(`vars[${name}] = await ${page}.title();`);
      else if (ex?.source === 'value') lines.push(`vars[${name}] = await ${loc()}.inputValue();`);
      else if (ex?.source === 'attribute') lines.push(`vars[${name}] = (await ${loc()}.getAttribute(${q(ex.attribute ?? 'href')})) ?? '';`);
      else lines.push(`vars[${name}] = await ${loc()}.innerText();`);
      break;
    }
    case 'setVariable':
      lines.push(`vars[${q(step.variable ?? 'value')}] = ${valueCode(step.value, usesFaker)};`);
      break;
    case 'screenshot':
      lines.push(`await ${page}.screenshot({ path: ${q(`${step.screenshot?.name || 'screenshot'}.png`)}${step.screenshot?.fullPage ? ', fullPage: true' : ''} });`);
      break;
    case 'script':
      lines.push(`await ${page}.evaluate(async () => {`, ...(step.code ?? '').split('\n').map((l) => `  ${l}`), '});');
      break;
    case 'newTab':
      lines.push(`pages.push(await context.newPage());`);
      if (step.url && step.url !== 'about:blank') lines.push(`await pages[pages.length - 1].goto(${q(step.url)});`);
      break;
    case 'closeTab':
      lines.push(`await ${page}.close();`);
      break;
    case 'goBack':
      lines.push(`await ${page}.goBack();`);
      break;
    case 'goForward':
      lines.push(`await ${page}.goForward();`);
      break;
    case 'reload':
      lines.push(`await ${page}.reload();`);
      break;
    case 'dialog':
      lines.push(`${page}.once('dialog', (d) => d.${step.dialog?.action === 'dismiss' ? 'dismiss()' : `accept(${step.dialog?.promptText ? q(step.dialog.promptText) : ''})`});`);
      break;
  }
  return [...comment, ...lines];
}

export function toPlaywright(flow: Flow): string {
  const usesFaker = { on: false };
  const body: string[] = [];
  const steps = flow.steps.filter((s) => s.enabled);
  // Dialog handlers must be registered before the action that opens the dialog.
  const ordered: Step[] = [];
  for (const s of steps) {
    if (s.type === 'dialog' && ordered.length) ordered.splice(ordered.length - 1, 0, s);
    else ordered.push(s);
  }
  const multiTab = steps.some((s) => (s.tab ?? 0) > 0);
  for (const s of ordered) {
    const code = stepCode(s, usesFaker);
    if (s.optional) body.push('try {', ...code.map((l) => `  ${l}`), '} catch { /* optional step */ }');
    else body.push(...code);
  }
  const header = [`// Exported from Xero Browser Automation on ${new Date().toISOString().slice(0, 10)}`, `import { test, expect } from '@playwright/test';`];
  if (usesFaker.on) header.push(`import { faker } from '@faker-js/faker';`);
  header.push('');
  const vars = flow.variables.length ? `  const vars: Record<string, string> = ${JSON.stringify(Object.fromEntries(flow.variables.map((v) => [v.name, v.value])), null, 2).replace(/\n/g, '\n  ')};` : '  const vars: Record<string, string> = {};';
  const tabsSetup = multiTab
    ? ["  const pages = [page];", "  context.on('page', (p) => { if (!pages.includes(p)) pages.push(p); });"]
    : [];
  const fixture = multiTab ? '{ page, context }' : '{ page }';
  return [
    ...header,
    `test(${q(flow.name)}, async (${fixture}) => {`,
    vars,
    "  const row: Record<string, string> = {};",
    ...tabsSetup,
    ...body.map((l) => `  ${l}`),
    '});',
    '',
  ].join('\n');
}
