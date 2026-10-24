// Fast checks for pure logic: scheduling, exports, templates and field detection.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toPlaywright } from '../src/main/export/playwright';
import { runDataCsv, runReportHtml, toCsv } from '../src/main/export/report';
import { computeNextRun, validateCron } from '../src/main/scheduler';
import { createGeneratorScope, DATA_TYPES, generateValue } from '../src/shared/data/catalog';
import { detectFieldType } from '../src/shared/data/detect';
import { LOCALES } from '../src/shared/data/locales';
import { newFlow } from '../src/shared/defaults';
import { renderTemplate } from '../src/shared/template';
import type { FieldInfo, Run, Schedule, Step } from '../src/shared/types';

let failures = 0;
const check = (cond: unknown, label: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};

console.log('Scheduling');
const base: Schedule = { id: 's', flowId: 'f', enabled: true, kind: 'daily', time: '09:30', createdAt: Date.now() };
const now = new Date(2026, 9, 23, 10, 0, 0).getTime();
const daily = computeNextRun(base, now)!;
check(new Date(daily).getHours() === 9 && new Date(daily).getMinutes() === 30 && new Date(daily).getDate() === 24, 'daily 09:30 after 10:00 is tomorrow 09:30');
const weekly = computeNextRun({ ...base, kind: 'weekly', days: [1], time: '08:00' }, now)!;
check(new Date(weekly).getDay() === 1 && new Date(weekly).getHours() === 8, 'weekly Monday 08:00');
const interval = computeNextRun({ ...base, kind: 'interval', everyMinutes: 15, lastRunAt: now - 5 * 60_000 }, now)!;
check(interval === now + 10 * 60_000, 'interval runs 15 minutes after the last run');
check(computeNextRun({ ...base, kind: 'once', at: now + 1000 }, now) === now + 1000, 'one-off schedule');
check(computeNextRun({ ...base, kind: 'once', at: now - 1000, lastRunAt: now }, now) === undefined, 'one-off does not repeat');
check(validateCron('*/5 * * * *') === null && validateCron('nope') !== null, 'cron validation');
check(computeNextRun({ ...base, enabled: false }, now) === undefined, 'disabled schedules have no next run');

console.log('Templates');
const scope = createGeneratorScope('en_US', { iteration: 3 });
const out = renderTemplate('{{persona.firstName | lower}}.{{iteration | pad:3}}@{{var.domain}} {{int:5:5}} {{missing}}', { vars: { domain: 'test.dev' }, persona: scope.persona, iteration: 3 });
check(out.startsWith(scope.persona().firstName.toLowerCase()) && out.includes('.003@test.dev 5 {{missing}}'), `template renders (${out})`);
check(renderTemplate('{{now | date:YYYY}}', { vars: {}, iteration: 1 }) === String(new Date().getFullYear()), 'date filter');

console.log('Generators');
let broken = 0;
for (const loc of LOCALES) {
  for (const d of DATA_TYPES) {
    try {
      const s = createGeneratorScope(loc.id, { iteration: 1 });
      generateValue(d.id, undefined, s);
    } catch (e) {
      broken++;
      if (broken < 5) console.log(`    ${loc.id} ${d.id}: ${(e as Error).message}`);
    }
  }
}
check(broken === 0, `all ${DATA_TYPES.length} data types generate in all ${LOCALES.length} locales`);
const p = createGeneratorScope('de', { iteration: 1 });
const email = generateValue('internet.email', undefined, p);
check(/^[a-z0-9._]+@/.test(email), `German persona email is ASCII (${email})`);
const field: FieldInfo = { tag: 'input', type: 'date' };
check(/^\d{4}-\d{2}-\d{2}$/.test(generateValue('person.birthdate', { format: 'DD/MM/YYYY' }, p, field)), 'date inputs always get ISO dates');
check(generateValue('text.paragraph', undefined, p, { tag: 'input', maxLength: 20 }).length <= 20, 'max length is respected');
const n = Number(generateValue('number.int', undefined, p, { tag: 'input', type: 'number', min: '18', max: '21' }));
check(n >= 18 && n <= 21, `number uses field min/max (${n})`);

console.log('Field detection');
const top = (f: FieldInfo, v?: string) => detectFieldType(f, v)[0]?.dataType;
check(top({ tag: 'input', name: 'fname' }) === 'person.firstName', 'fname → first name');
check(top({ tag: 'input', label: 'Nachname' }) === 'person.lastName', 'Nachname → last name');
check(top({ tag: 'input', placeholder: 'Card number' }) === 'finance.creditCard', 'card number');
check(top({ tag: 'input', label: 'CVC' }) === 'finance.cvv', 'CVC');
check(top({ tag: 'input', label: 'MM / YY' }) === 'finance.expiry', 'MM / YY expiry');
check(top({ tag: 'input', label: 'Company name' }) === 'company.name', 'company name is not a person name');
check(top({ tag: 'input', label: 'Email address' }) === 'internet.email', 'email address is not a street address');
check(top({ tag: 'input', name: 'q' }, 'running shoes') === 'text.words', 'search box');
check(top({ tag: 'textarea', label: 'Message' }) === 'text.paragraph', 'message textarea');
check(top({ tag: 'input', label: 'Postcode' }, 'SW1A 1AA') === 'address.zip', 'UK postcode');
check(top({ tag: 'input', label: 'Verification code' }, '482913') === 'id.otp', 'verification code');
check(top({ tag: 'input' }, 'jane@corp.io') === 'internet.email', 'email recognised from the typed value alone');
check(top({ tag: 'input', autocomplete: 'shipping postal-code' }) === 'address.zip', 'autocomplete with section token');
check(top({ tag: 'select', label: 'Country', options: [{ value: 'US', label: 'United States' }] }) === 'choice.option', 'dropdowns pick a real option');

console.log('Exports');
const steps: Step[] = JSON.parse(readFileSync(resolve('tests/.output/recorded-steps.json'), 'utf8'));
steps[2].value = { mode: 'random', dataType: 'internet.email' };
const code = toPlaywright({ ...newFlow({ name: 'Sign "up"' }), steps });
check(code.includes("import { test, expect } from '@playwright/test'") && code.includes('faker.internet.email()') && code.includes('test("Sign \\"up\\""'), 'Playwright test is generated');
check(code.includes("page.once('dialog'"), 'dialog handler is registered before the action');
const dialogAt = code.indexOf("page.once('dialog'");
const deleteAt = code.indexOf('Delete workspace');
check(dialogAt > 0 && dialogAt < deleteAt, 'dialog handler comes before the click that opens it');
const run: Run = {
  id: 'r1', flowId: 'f', flowName: 'Demo <run>', status: 'failed', trigger: 'manual', options: { speed: 1, headless: true } as Run['options'], startedAt: Date.now(), endedAt: Date.now() + 5000, duration: 5000,
  totals: { total: 2, passed: 1, failed: 1, stopped: 0, running: 0, pending: 0 },
  iterations: [
    { index: 0, status: 'passed', attempt: 1, steps: [], data: { Email: 'a@b.co', Note: 'has, comma' }, variables: { orderId: '42' }, duration: 2000 },
    { index: 1, status: 'failed', attempt: 1, steps: [], data: { Email: 'c@d.co' }, variables: {}, error: 'Could not find button', failedStep: 1, duration: 3000 },
  ],
  logs: [], steps: steps.slice(0, 3),
};
const html = runReportHtml(run, resolve('tests/.output'));
check(html.includes('Demo &lt;run&gt;') && html.includes('Could not find button') && html.includes('Failures (1)'), 'HTML report escapes and lists failures');
const csv = runDataCsv(run);
check(csv.split('\r\n')[0] === 'Iteration,Status,Duration (s),Error,Email,Note,var:orderId' && csv.includes('"has, comma"'), 'CSV has one column per field and quotes commas');
check(toCsv(['a'], [{ a: 'x"y' }]) === 'a\r\n"x""y"', 'CSV escapes quotes');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll unit checks passed');
process.exit(failures ? 1 : 0);
