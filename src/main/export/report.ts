import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDuration } from '../../shared/data/format';
import { stepTitle } from '../../shared/steps';
import type { Run } from '../../shared/types';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.map(csvEscape).join(','), ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','))].join('\r\n');
}

/** One row per iteration with every value the run typed or chose. */
export function runDataCsv(run: Run): string {
  const dataCols = new Set<string>();
  const varCols = new Set<string>();
  for (const it of run.iterations) {
    Object.keys(it.data ?? {}).forEach((k) => dataCols.add(k));
    Object.keys(it.variables ?? {}).forEach((k) => varCols.add(k));
  }
  const vars = [...varCols].filter((v) => !dataCols.has(v)).map((v) => `var:${v}`);
  const columns = ['Iteration', 'Status', 'Duration (s)', 'Error', ...dataCols, ...vars];
  const rows = run.iterations.map((it) => {
    const row: Record<string, unknown> = {
      Iteration: it.index + 1,
      Status: it.status,
      'Duration (s)': it.duration !== undefined ? (it.duration / 1000).toFixed(2) : '',
      Error: it.error ?? '',
      ...it.data,
    };
    for (const v of vars) row[v] = it.variables?.[v.slice(4)] ?? '';
    return row;
  });
  return toCsv(columns, rows);
}

function img(dir: string, file?: string): string {
  if (!file) return '';
  const p = join(dir, file);
  if (!existsSync(p)) return '';
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `<img loading="lazy" src="data:${mime};base64,${readFileSync(p).toString('base64')}" alt="Screenshot">`;
}

export function runReportHtml(run: Run, artifactsDir: string): string {
  const t = run.totals;
  const rate = t.total ? Math.round((t.passed / Math.max(1, t.passed + t.failed)) * 100) : 0;
  const done = run.iterations.filter((i) => i.duration !== undefined);
  const avg = done.length ? done.reduce((a, i) => a + (i.duration ?? 0), 0) / done.length : undefined;
  const failed = run.iterations.filter((i) => i.status === 'failed');
  let embedded = 0;
  const failureBlocks = failed
    .slice(0, 50)
    .map((it) => {
      const step = it.failedStep !== undefined ? run.steps[it.failedStep] : undefined;
      const failedResult = it.steps.find((s) => s.index === it.failedStep);
      const shot = embedded < 30 ? img(artifactsDir, failedResult?.screenshot ?? it.screenshot) : '';
      if (shot) embedded++;
      return `<section class="fail">
        <h3>Iteration ${it.index + 1}${step ? ` · step ${(it.failedStep ?? 0) + 1}: ${esc(stepTitle(step))}` : ''}</h3>
        <p class="err">${esc(it.error)}</p>
        ${shot}
      </section>`;
    })
    .join('');
  const rows = run.iterations
    .map(
      (it) => `<tr class="${it.status}">
        <td>${it.index + 1}</td><td><span class="pill ${it.status}">${it.status}</span></td>
        <td>${formatDuration(it.duration)}</td><td>${it.attempt > 1 ? it.attempt : ''}</td>
        <td>${it.failedStep !== undefined ? it.failedStep + 1 : ''}</td><td class="errcell">${esc(it.error ?? '')}</td></tr>`,
    )
    .join('');
  const dataCols = [...new Set(run.iterations.flatMap((i) => Object.keys(i.data ?? {})))].slice(0, 12);
  const dataTable = dataCols.length
    ? `<h2>Data used</h2><div class="scroll"><table><thead><tr><th>#</th>${dataCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${run.iterations
        .slice(0, 500)
        .map((it) => `<tr><td>${it.index + 1}</td>${dataCols.map((c) => `<td>${esc(it.data?.[c] ?? '')}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`
    : '';
  const stepsList = run.steps
    .map((s, i) => {
      const results = run.iterations.map((it) => it.steps.find((r) => r.index === i)).filter(Boolean);
      const fails = results.filter((r) => r!.status === 'failed').length;
      const durs = results.filter((r) => r!.status === 'passed').map((r) => r!.duration);
      const avgStep = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : undefined;
      return `<tr${s.enabled ? '' : ' class="off"'}><td>${i + 1}</td><td>${esc(stepTitle(s))}</td><td>${formatDuration(avgStep)}</td><td>${fails || ''}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(run.flowName)} — run report</title>
<style>
  :root { --bg:#F3F4F7; --panel:#fff; --line:#DFE2E9; --text:#1A1F2B; --muted:#5E6678; --pass:#1E9E68; --fail:#D63A4A; --warn:#B7791F; --accent:#3D5CE8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#15181F; --panel:#1B1F28; --line:#2E3443; --text:#E7E9EF; --muted:#949BAD; --pass:#3CCB8A; --fail:#FF6B78; --warn:#F2B544; --accent:#7E9BFF; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 36px 0 12px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  .meta { color: var(--muted); }
  .kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap: 12px; margin-top: 24px; }
  .kpi { background:var(--panel); border:1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .kpi b { display:block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .kpi span { color: var(--muted); font-size: 12.5px; }
  .strip { display:flex; flex-wrap:wrap; gap:2px; margin-top: 18px; }
  .strip i { width:10px; height:18px; border-radius:2px; background: var(--line); }
  .strip i.passed { background: var(--pass); } .strip i.failed { background: var(--fail); } .strip i.stopped { background: var(--warn); }
  table { width:100%; border-collapse: collapse; background: var(--panel); border:1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align:left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-variant-numeric: tabular-nums; }
  th { font-weight: 600; color: var(--muted); font-size: 12.5px; background: color-mix(in srgb, var(--panel) 92%, var(--text)); }
  tr:last-child td { border-bottom: 0; }
  tr.off td { color: var(--muted); text-decoration: line-through; }
  .pill { padding: 1px 8px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  .pill.passed { color: var(--pass); background: color-mix(in srgb, var(--pass) 14%, transparent); }
  .pill.failed { color: var(--fail); background: color-mix(in srgb, var(--fail) 14%, transparent); }
  .pill.stopped, .pill.pending { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .errcell { color: var(--fail); max-width: 420px; }
  .fail { background: var(--panel); border:1px solid var(--line); border-left: 3px solid var(--fail); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .fail img { max-width: 100%; border-radius: 6px; border:1px solid var(--line); margin-top: 8px; }
  .err { color: var(--fail); margin: 0; }
  .scroll { overflow-x: auto; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12.5px; }
</style></head>
<body><main>
  <h1>${esc(run.flowName)}</h1>
  <div class="meta">Run on ${esc(new Date(run.startedAt).toLocaleString())} · ${esc(run.trigger === 'schedule' ? 'Scheduled' : 'Manual')} · ${run.options.headless ? 'Background browser' : 'Visible browser'} · Speed ${run.options.speed === 0 ? 'max' : `${run.options.speed}×`}</div>
  <div class="kpis">
    <div class="kpi"><b>${run.status[0].toUpperCase()}${run.status.slice(1)}</b><span>Result</span></div>
    <div class="kpi"><b>${t.passed} / ${t.total}</b><span>Iterations passed</span></div>
    <div class="kpi"><b>${rate}%</b><span>Pass rate</span></div>
    <div class="kpi"><b>${formatDuration(run.duration)}</b><span>Total time</span></div>
    <div class="kpi"><b>${formatDuration(avg)}</b><span>Average iteration</span></div>
    <div class="kpi"><b>${run.healedCount ?? 0}</b><span>Selectors healed</span></div>
  </div>
  <div class="strip" aria-label="Iteration results">${run.iterations
    .slice(0, 2000)
    .map((it) => `<i class="${it.status}" title="Iteration ${it.index + 1}: ${it.status}"></i>`)
    .join('')}</div>
  ${failed.length ? `<h2>Failures (${failed.length})</h2>${failureBlocks}` : ''}
  <h2>Iterations</h2>
  <div class="scroll"><table><thead><tr><th>#</th><th>Status</th><th>Duration</th><th>Attempt</th><th>Failed step</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${dataTable}
  <h2>Steps</h2>
  <table><thead><tr><th>#</th><th>Step</th><th>Average time</th><th>Failures</th></tr></thead><tbody>${stepsList}</tbody></table>
  <footer>Generated by Xero Browser Automation</footer>
</main></body></html>`;
}
