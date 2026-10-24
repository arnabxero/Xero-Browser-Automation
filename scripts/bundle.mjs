// Shared esbuild configuration for the main process, preload and injected recorder.
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildRecorder(minify = true) {
  const res = await esbuild.build({
    entryPoints: [join(root, 'src/injected/recorder.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome110',
    platform: 'browser',
    minify,
    legalComments: 'none',
  });
  return res.outputFiles[0].text;
}

/** Resolves `import source from 'virtual:recorder'` to the bundled recorder source. */
export function recorderPlugin(minify = true) {
  return {
    name: 'virtual-recorder',
    setup(build) {
      build.onResolve({ filter: /^virtual:recorder$/ }, () => ({ path: 'recorder', namespace: 'virtual-recorder' }));
      build.onLoad({ filter: /.*/, namespace: 'virtual-recorder' }, async () => {
        const code = await buildRecorder(minify);
        return {
          contents: `export default ${JSON.stringify(code)};`,
          loader: 'js',
          watchFiles: [join(root, 'src/injected/recorder.ts'), join(root, 'src/injected/dom.ts'), join(root, 'src/injected/protocol.ts')],
        };
      });
    },
  };
}

export function mainOptions({ dev = false } = {}) {
  return {
    entryPoints: [join(root, 'src/main/index.ts')],
    outfile: join(root, 'out/main/index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'playwright-core'],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    keepNames: true,
    legalComments: 'none',
    plugins: [recorderPlugin(!dev)],
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
    logLevel: 'warning',
  };
}

export function preloadOptions({ dev = false } = {}) {
  return {
    entryPoints: [join(root, 'src/preload/index.ts')],
    outfile: join(root, 'out/preload/index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    logLevel: 'warning',
  };
}
