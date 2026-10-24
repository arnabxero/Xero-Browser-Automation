// End-to-end engine test: records a session on the practice page, then replays it
// with generated data. Run with `node scripts/test-engine.mjs`.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LiveSession } from '../src/main/live';
import { RECORDER_SOURCE } from '../src/main/recorderSource';
import { Repo } from '../src/main/repo';
import { RunManager } from '../src/main/runner';
import { dataTypeLabel } from '../src/shared/data/catalog';
import { newStep } from '../src/shared/defaults';
import { stepDetail, stepTitle } from '../src/shared/steps';
import type { RunSummary, Step } from '../src/shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond: unknown, label: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};

async function main() {
  const playground = pathToFileURL(resolve('resources/playground/index.html')).toString();
  const dir = mkdtempSync(join(tmpdir(), 'xero-test-'));
  const avatar = join(dir, 'avatar.png');
  writeFileSync(avatar, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex'));
  const repo = new Repo(dir);
  const browser = (process.env.XERO_BROWSER as 'msedge' | 'chrome' | 'chromium') || 'msedge';
  repo.updateSettings({ browser, runDefaults: { ...repo.settings().runDefaults, browser } });

  const steps: Step[] = [];
  const notices: string[] = [];
  const live = new LiveSession({
    emit: (e) => {
      if (e.type === 'recorded') {
        if (e.op === 'add') steps.push(e.step);
        if (e.op === 'update') {
          const i = steps.findIndex((s) => s.id === e.step.id);
          if (i >= 0) steps[i] = e.step;
        }
        if (e.op === 'remove') {
          const i = steps.findIndex((s) => s.id === e.id);
          if (i >= 0) steps.splice(i, 1);
        }
      }
      if (e.type === 'notice') notices.push(`${e.level}: ${e.message}`);
    },
    settings: () => repo.settings(),
    chooseFiles: async () => [avatar],
    askDialog: async () => ({ accept: true }),
    sessionFile: (id) => repo.sessionFile(id),
    saveSession: (n, s) => repo.saveSession(n, s),
    headless: true,
  });

  console.log('Recording…');
  const t0 = Date.now();
  await live.start({ flowId: 'f1', url: playground, record: true, addNavigateStep: true });
  console.log(`  browser ready in ${Date.now() - t0} ms`);
  const page = live.pages[0];
  await page.waitForLoadState('domcontentloaded');
  await sleep(300);

  const type = async (sel: string, text: string) => {
    await page.click(sel);
    await page.keyboard.type(text, { delay: 5 });
  };
  await type('#first-name', 'John');
  await type('#last-name', 'Smith');
  await type('#email', 'john.smith@example.com');
  await type('#phone', '(555) 123-4567');
  await page.fill('#dob', '1990-04-12');
  await page.click('input[value=male]');
  await type('#username', 'jsmith');
  await type('#password', 'Secret123!');
  await type('#password2', 'Secret123!');
  await page.selectOption('#plan', 'team');
  await type('#company', 'Acme Inc');
  await type('#job', 'Engineer');
  await type('#city', 'Austin');
  await type('#zip', '78701');
  await page.selectOption('#country', 'US');
  await page.click('label:has(input[value=research])');
  await type('#about', 'We are a small team that writes a lot of meeting notes.');
  await page.click('label:has(#newsletter)');
  await page.click('#avatar');
  await sleep(300);
  await page.click('label:has(#terms)');
  await page.click('#delete-btn');
  await sleep(300);
  const widget = page.frameLocator('iframe[name=feedback]');
  await widget.locator('#nps').click();
  await page.keyboard.type('9');
  await widget.locator('#send').click();
  await sleep(200);
  await page.click('[data-testid=create-account]');
  await page.waitForSelector('#success.show', { timeout: 5000 });
  await sleep(600);
  await live.stopRecording();

  console.log(`Recorded ${steps.length} steps:`);
  steps.forEach((s, i) => {
    const sug = s.suggestions?.[0] ? `  → ${dataTypeLabel(s.suggestions[0].dataType)} ${Math.round(s.suggestions[0].confidence * 100)}%` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${stepTitle(s)}  ${stepDetail(s)}${sug}   [${s.target?.selectors[0]?.kind ?? ''}]`);
  });
  if (notices.length) console.log('Notices:', notices);

  const byType = (t: string) => steps.filter((s) => s.type === t);
  check(steps[0]?.type === 'navigate', 'first step opens the page');
  check(byType('fill').length >= 12, `typing captured as fill steps (${byType('fill').length})`);
  check(!steps.some((s, i) => s.type === 'click' && steps[i + 1]?.type === 'fill' && s.target?.selectors[0]?.value === steps[i + 1].target?.selectors[0]?.value), 'focus clicks before typing were merged away');
  check(byType('select').length === 2, 'two dropdown selections');
  check(byType('check').length >= 2, 'radio and checkbox recorded as check');
  check(byType('upload').length === 1, 'file upload recorded through the file chooser');
  check(byType('dialog').length === 1, 'confirm dialog recorded');
  check(steps.some((s) => s.type === 'fill' && s.target?.framePath?.length), 'typing inside an iframe keeps its frame path');
  check(steps.filter((s) => s.type === 'fill' && s.field?.name === 'zip').length === 1, 'no duplicate fill when a field loses focus');
  const email = steps.find((s) => s.type === 'fill' && s.field?.name === 'email');
  check(email?.suggestions?.[0]?.dataType === 'internet.email', 'email field detected as Email address');
  const pw2 = steps.find((s) => s.type === 'fill' && s.field?.name === 'confirmPassword');
  check(pw2?.suggestions?.[0]?.dataType === 'internet.password', 'confirm password detected as Password');
  const zip = steps.find((s) => s.type === 'fill' && s.field?.name === 'zip');
  check(zip?.suggestions?.[0]?.dataType === 'address.zip', 'zip detected as ZIP code');
  const dob = steps.find((s) => s.type === 'fill' && s.field?.name === 'dob');
  check(dob?.suggestions?.[0]?.dataType === 'person.birthdate', `date of birth detected (${dob?.suggestions?.[0]?.dataType})`);

  mkdirSync(resolve('tests/.output'), { recursive: true });
  writeFileSync(resolve('tests/.output/recorded-steps.json'), JSON.stringify(steps, null, 1));
  // Turn detected fields into random data and add a check at the end.
  for (const s of steps) {
    if (s.type === 'fill' && s.suggestions?.[0] && s.suggestions[0].confidence >= 0.5) s.value = { mode: 'random', dataType: s.suggestions[0].dataType, static: s.value?.static };
    if (s.type === 'select' && s.field?.name === 'plan') s.value = { mode: 'random', dataType: 'choice.option' };
  }
  steps.push(newStep('assert', { target: { selectors: [{ kind: 'css', value: '#welcome', score: 50 }], fingerprint: { tag: 'h1' }, description: 'heading “Welcome”' }, assert: { kind: 'text', op: 'contains', expected: 'Welcome, ' } }));
  steps.push(newStep('extract', { target: { selectors: [{ kind: 'css', value: '[data-field=email]', score: 50 }], fingerprint: { tag: 'dd' }, description: 'saved email' }, extract: { source: 'text', variable: 'savedEmail' } }));
  await live.close();

  const flow = repo.createFlow({ name: 'Practice sign-up', steps });
  console.log('Replaying 3 iterations (2 in parallel, headless, max speed)…');
  const finished = new Promise<RunSummary>((res) => {
    const runner = new RunManager({ repo, recorderSource: RECORDER_SOURCE, emit: () => undefined, onFinished: res });
    runner.start(flow.id, { iterations: 3, concurrency: 2, headless: true, speed: 0, browser, screenshots: 'failure', stepTimeout: 8000 });
  });
  const summary = await finished;
  const run = repo.runs.get(summary.id)!;
  console.log(`  status ${run.status}, ${run.totals.passed}/${run.totals.total} passed in ${run.duration} ms`);
  for (const it of run.iterations) {
    if (it.status !== 'passed') console.log(`  iteration ${it.index + 1}: ${it.status} at step ${(it.failedStep ?? -1) + 1}: ${it.error}`);
  }
  const d = run.iterations[0].data;
  console.log('  iteration 1 data:', JSON.stringify(d).slice(0, 600));
  console.log('  iteration 1 vars:', JSON.stringify(run.iterations[0].variables));
  check(run.status === 'passed', 'replay passed');
  check(run.iterations[0].variables.savedEmail && run.iterations[0].variables.savedEmail !== 'john.smith@example.com', 'random email was submitted and read back');
  const emails = new Set(run.iterations.map((i) => i.variables.savedEmail));
  check(emails.size === 3, 'each iteration used a different email');
  const p1 = Object.entries(d).filter(([k]) => /password/i.test(k)).map(([, v]) => v);
  check(p1.length === 2 && p1[0] === p1[1], `password and confirmation match within an iteration (${p1.length})`);
  for (const l of run.logs.filter((l) => l.level === 'warn' || l.level === 'error').slice(0, 10)) console.log(`  log ${l.level}: ${l.msg}`);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
