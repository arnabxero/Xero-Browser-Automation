import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import { mainOptions, preloadOptions, root } from './bundle.mjs';

const t0 = Date.now();
rmSync(join(root, 'out'), { recursive: true, force: true });

await Promise.all([esbuild.build(mainOptions()), esbuild.build(preloadOptions())]);
console.log('✓ main and preload');

await viteBuild({ configFile: join(root, 'vite.config.mts'), logLevel: 'warn' });
console.log('✓ renderer');

console.log(`Built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
