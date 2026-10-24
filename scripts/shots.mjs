// Launches the built app with a throwaway data folder and captures screenshots of each screen.
// Usage: node scripts/shots.mjs <outDir> [theme]
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root } from './bundle.mjs';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] ?? join(root, 'out/shots');
const theme = process.argv[3] ?? 'dark';
mkdirSync(outDir, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'xero-shots-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, XERO_DATA_DIR: dataDir } });
const win = await app.firstWindow();
win.on('console', (m) => {
  if (m.type() === 'error') console.log('console error:', m.text());
});
win.on('pageerror', (e) => console.log('page error:', e.message));
await win.waitForSelector('text=What should the browser do for you?', { timeout: 20000 });
await win.evaluate((t) => window.xero.settings.update({ theme: t, onboardingDone: true }), theme);
await sleep(400);
const shot = async (name) => {
  await sleep(350);
  await win.screenshot({ path: join(outDir, `${theme}-${name}.png`) });
  console.log('shot', name);
};
const go = async (hash) => {
  await win.evaluate((h) => (window.location.hash = h), hash);
  await sleep(500);
};

await shot('01-home-empty');
await go('/record');
await shot('02-record');

const steps = JSON.parse(readFileSync(join(root, 'tests/.output/recorded-steps.json'), 'utf8'));
const flowId = await win.evaluate(async (steps) => {
  const f = await window.xero.flows.create({ name: 'Practice sign-up', startUrl: steps[0].url, tags: ['demo', 'signup'] });
  await window.xero.flows.save({ ...f, steps });
  const g = await window.xero.flows.create({ name: 'Checkout with a new customer', startUrl: 'https://shop.example.com', tags: ['shop'] });
  await window.xero.flows.save({ ...g, steps: steps.slice(0, 6) });
  return f.id;
}, steps);

await go(`/flows/${flowId}`);
await win.locator('[role=option]').nth(3).click();
await shot('03-editor-fill');
await win.locator('[role=option]').nth(10).click();
await shot('04-editor-select');
await win.getByRole('button', { name: /Generated data/ }).click();
await shot('05-smart-fill');
await win.getByRole('button', { name: /Apply to/ }).click();
await sleep(300);
await win.locator('[role=option]').nth(3).click();
await shot('06-editor-random');
await win.getByRole('button', { name: 'Run…' }).click();
await shot('07-run-dialog');
await win.keyboard.press('Escape');

const runId = await win.evaluate((id) => window.xero.runs.start(id, { iterations: 6, concurrency: 3, headless: true, speed: 0, screenshots: 'end' }), flowId);
await go(`/runs/${runId}`);
await sleep(1500);
await shot('08-run-live');
for (let i = 0; i < 60; i++) {
  const r = await win.evaluate((id) => window.xero.runs.get(id), runId);
  if (r && !['running', 'queued', 'paused'].includes(r.status)) break;
  await sleep(500);
}
await sleep(800);
await shot('09-run-done');
await win.getByRole('tab', { name: /Data used/ }).click();
await shot('10-run-data');

await go('/');
await shot('11-home');
await go('/flows');
await shot('12-flows');
await go('/runs');
await shot('13-runs');
await go('/data?generate=1');
await shot('14-generator');
await go('/schedules');
await shot('15-schedules');
await go('/settings');
await shot('16-settings');
await win.keyboard.press('Control+K');
await shot('17-palette');

await app.close();
console.log('done', outDir);
