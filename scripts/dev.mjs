// Development: Vite dev server for the UI, esbuild watch for main/preload, auto-restarting Electron.
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createServer } from 'vite';
import { mainOptions, preloadOptions, root } from './bundle.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const server = await createServer({ configFile: join(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`UI dev server: ${url}`);

let child = null;
let restarting = false;
function startElectron() {
  child = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  child.on('exit', (code) => {
    if (!restarting) {
      server.close();
      process.exit(code ?? 0);
    }
  });
}

function restart() {
  if (!child) return startElectron();
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    startElectron();
  });
  child.kill();
}

let ready = 0;
const reloadPlugin = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd((res) => {
      if (res.errors.length) return;
      if (ready < 2) {
        ready++;
        if (ready === 2) startElectron();
        return;
      }
      console.log('↻ restarting Electron');
      restart();
    });
  },
};

const main = await esbuild.context({ ...mainOptions({ dev: true }), plugins: [...mainOptions({ dev: true }).plugins, reloadPlugin] });
const preload = await esbuild.context({ ...preloadOptions({ dev: true }), plugins: [reloadPlugin] });
await Promise.all([main.watch(), preload.watch()]);
