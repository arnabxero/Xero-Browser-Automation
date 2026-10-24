// Bundles tests/<name>.test.ts (TypeScript + the virtual recorder) and runs it with Node.
// Usage: node scripts/test.mjs [units|engine]
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { recorderPlugin, root } from './bundle.mjs';

const name = process.argv[2] ?? 'units';
const outfile = join(root, `out/tests/${name}.test.cjs`);
await esbuild.build({
  entryPoints: [join(root, `tests/${name}.test.ts`)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['playwright-core', 'electron'],
  plugins: [recorderPlugin(false)],
  sourcemap: 'inline',
  logLevel: 'warning',
});
const res = spawnSync(process.execPath, ['--enable-source-maps', outfile], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
