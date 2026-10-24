// UI end-to-end test: drives the real app to record, refine, play back and run a flow.
// The live browser runs headless with a debug port so this script can act as the user.
// Usage: node scripts/ui-e2e.mjs [screenshotDir]
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';
import { root } from './bundle.mjs';

const require = createRequire(import.meta.url);
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};
const PORT = 9339;
const playground = pathToFileURL(join(root, 'resources/playground/index.html')).toString();

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: root,
  env: { ...process.env, XERO_DATA_DIR: mkdtempSync(join(tmpdir(), 'xero-e2e-')), XERO_LIVE_HEADLESS: '1', XERO_LIVE_DEBUG_PORT: String(PORT) },
});
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('page error:', e.message));
const shot = async (name) => shots && (await sleep(300), await win.screenshot({ path: join(shots, `e2e-${name}.png`) }));

try {
  await win.waitForSelector('text=What should the browser do for you?', { timeout: 20000 });
  await win.evaluate(() => window.xero.settings.update({ recorder: { dialogs: 'accept' } }));

  console.log('Start recording from the home page');
  await win.getByLabel('Website address').fill(playground);
  await win.getByRole('button', { name: 'Start recording' }).click();
  await win.waitForFunction(() => location.hash.startsWith('#/flows/'), null, { timeout: 15000 });
  for (let i = 0; i < 120; i++) {
    if ((await win.evaluate(() => window.xero.live.getState())).mode === 'recording') break;
    await sleep(250);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file:'));
    if (!page) await sleep(200);
  }
  check(!!page, 'live browser opened the page');
  await page.waitForSelector('#first-name');
  await sleep(400);

  console.log('Act as the user in the browser');
  const type = async (sel, text) => {
    await page.click(sel);
    await page.keyboard.type(text, { delay: 10 });
  };
  await type('#first-name', 'Ada');
  await type('#last-name', 'Lovelace');
  await type('#email', 'ada@example.com');
  // A throwaway value for the practice form, generated so the repo holds no credential-like literal.
  const practicePassword = `Pw${Math.random().toString(36).slice(2, 10)}!9`;
  await type('#password', practicePassword);
  await type('#password2', practicePassword);
  await page.selectOption('#plan', 'business');
  await type('#zip', '10001');
  await page.click('label:has(#terms)');
  await page.click('[data-testid=create-account]');
  await page.waitForSelector('#success.show');
  await sleep(800);

  const rows = await win.locator('[role=listbox][aria-label=Steps] [role=option]').count();
  check(rows >= 9, `editor shows recorded steps while recording (${rows})`);
  await shot('01-recording');

  console.log('Stop recording from the app');
  await win.getByRole('button', { name: 'Stop recording' }).first().click();
  await win.waitForSelector('text=Fill fields with generated data', { timeout: 10000 });
  check(true, 'generated-data review opens after stopping');
  await shot('02-review');
  await win.getByRole('button', { name: /Apply to \d+ field/ }).click();
  await sleep(500);
  const chips = await win.locator('[role=option] >> text=/Email address|First name|Password/').count();
  check(chips >= 3, `steps switched to generated data (${chips} labels)`);

  console.log('Play back in the live browser');
  await page.goto('about:blank');
  await win.getByRole('button', { name: 'Play', exact: true }).click();
  await win.waitForFunction(() => document.body.innerText.includes('Playback finished'), null, { timeout: 30000 }).catch(() => null);
  const failed = await win.locator('[aria-label=Failed]').count();
  const passed = await win.locator('[aria-label=Passed]').count();
  check(failed === 0 && passed >= 9, `playback passed every step (${passed} passed, ${failed} failed)`);
  const welcome = await page.textContent('#welcome').catch(() => '');
  check(welcome && welcome !== 'Welcome, Ada!' && welcome.startsWith('Welcome, '), `form was submitted with a generated name (“${welcome}”)`);
  await shot('03-played');

  console.log('Re-pick an element in the browser');
  const stepRows = win.locator('[role=listbox][aria-label=Steps] [role=option]');
  await stepRows.nth(7).click();
  await win.getByRole('button', { name: 'Pick again' }).click();
  await sleep(500);
  await page.goto(playground);
  await sleep(400);
  await page.click('#city');
  await win.waitForSelector('text=Element updated', { timeout: 10000 });
  const desc = await win.locator('aside[aria-label="Step details"] p.selectable[title]').first().textContent();
  check(desc?.includes('City'), `picked element replaces the target (${desc})`);
  await win.keyboard.press('Escape');
  await win.locator('[role=listbox][aria-label=Steps]').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await stepRows.nth(7).click();
  await win.keyboard.press('Control+z');
  await sleep(300);
  const restored = await win.locator('aside[aria-label="Step details"] p.selectable[title]').first().textContent();
  check(restored?.includes('ZIP'), `undo restores the previous target (${restored})`);

  console.log('Breakpoint and step-through');
  await stepRows.nth(4).hover();
  await stepRows.nth(4).getByRole('button', { name: 'Pause here during playback' }).click();
  await win.getByRole('button', { name: 'Play', exact: true }).click();
  await win.getByRole('button', { name: 'Next step' }).waitFor({ timeout: 20000 });
  const pausedAt = await win.evaluate(() => window.xero.live.getState());
  check(pausedAt.playback?.paused && pausedAt.playback.index === 4, `playback paused at the breakpoint (step ${pausedAt.playback?.index + 1})`);
  await win.getByRole('button', { name: 'Next step' }).click();
  await sleep(800);
  const afterStep = await win.evaluate(() => window.xero.live.getState());
  check(afterStep.playback?.paused && afterStep.playback.index === 5, `“Next step” runs one step (now before step ${afterStep.playback?.index + 1})`);
  await win.getByRole('button', { name: 'Continue' }).click();
  await win.waitForFunction(() => document.body.innerText.includes('Playback finished'), null, { timeout: 30000 });
  check(true, 'playback continues to the end');

  console.log('Save the browser login');
  await win.getByRole('button', { name: 'Save login' }).click();
  await win.getByRole('dialog').getByRole('button', { name: 'Save login' }).click();
  await sleep(600);
  const sessions = await win.evaluate(() => window.xero.sessions.list());
  check(sessions.length === 1, `login saved (${sessions[0]?.name})`);

  console.log('Run 5 iterations in the background');
  await win.getByRole('button', { name: 'Run…' }).click();
  await win.getByRole('dialog').getByRole('button', { name: '5', exact: true }).click();
  await win.getByRole('dialog').getByRole('radio', { name: /In background/ }).click();
  await win.getByRole('dialog').getByRole('radio', { name: 'Max' }).click();
  await win.getByRole('button', { name: /Start 5 iterations/ }).click();
  await win.waitForFunction(() => location.hash.startsWith('#/runs/'), null, { timeout: 10000 });
  await win.waitForSelector('text=Run again', { timeout: 60000 });
  const runId = await win.evaluate(() => location.hash.split('/').pop());
  const run = await win.evaluate((id) => window.xero.runs.get(id), runId);
  check(run.status === 'passed' && run.totals.passed === 5, `run passed (${run.totals.passed}/${run.totals.total}, ${run.status})`);
  const emails = new Set(run.iterations.map((i) => Object.entries(i.data).find(([k]) => /email/i.test(k))?.[1]));
  check(emails.size === 5, 'every iteration typed a different email');
  await shot('04-run');
  await browser.close().catch(() => undefined);
} catch (e) {
  failures++;
  console.error(e);
  await shot('error');
} finally {
  await app.close().catch(() => undefined);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll UI checks passed');
process.exit(failures ? 1 : 0);
