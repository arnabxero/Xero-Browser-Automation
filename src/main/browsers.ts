import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';
import type { BrowserChoice, BrowserInfo } from '../shared/types';

const env = process.env;
const PF = env['ProgramFiles'] || 'C:\\Program Files';
const PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = env['LOCALAPPDATA'] || '';

const CANDIDATES: Record<Exclude<BrowserChoice, 'chromium' | 'custom'>, string[]> = {
  msedge: [
    join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    LOCAL && join(LOCAL, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean),
  chrome: [
    join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    LOCAL && join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean),
  brave: [
    join(PF, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    join(PF86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    LOCAL && join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean),
};

const NAMES: Record<BrowserChoice, string> = {
  msedge: 'Microsoft Edge',
  chrome: 'Google Chrome',
  brave: 'Brave',
  chromium: 'Chromium (downloaded)',
  custom: 'Custom browser',
};

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

function bundledChromium(): string | undefined {
  try {
    const p = chromium.executablePath();
    return p && existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

export function detectBrowsers(customPath?: string): BrowserInfo[] {
  const list: BrowserInfo[] = [];
  for (const id of ['msedge', 'chrome', 'brave'] as const) {
    const path = firstExisting(CANDIDATES[id]);
    list.push({ id, name: NAMES[id], available: !!path, path });
  }
  const bundled = bundledChromium();
  list.push({ id: 'chromium', name: NAMES.chromium, available: !!bundled, path: bundled, note: bundled ? undefined : 'Download it from Settings to use it' });
  const custom = customPath && existsSync(customPath) ? customPath : undefined;
  list.push({ id: 'custom', name: NAMES.custom, available: !!custom, path: custom, note: custom ? undefined : 'Pick any Chromium-based browser in Settings' });
  return list;
}

export interface ResolvedBrowser {
  choice: BrowserChoice;
  name: string;
  executablePath?: string;
  fellBack: boolean;
}

export function resolveBrowser(choice: BrowserChoice, customPath?: string): ResolvedBrowser {
  const all = detectBrowsers(customPath);
  const wanted = all.find((b) => b.id === choice);
  if (wanted?.available) return { choice, name: wanted.name, executablePath: wanted.path, fellBack: false };
  const fallback = all.find((b) => b.available);
  if (!fallback) {
    throw new Error('No supported browser was found. Install Microsoft Edge or Google Chrome, or download Chromium from Settings → Browser.');
  }
  return { choice: fallback.id, name: fallback.name, executablePath: fallback.path, fellBack: true };
}

export interface LaunchRequest {
  choice: BrowserChoice;
  customPath?: string;
  headless: boolean;
  hideBanner: boolean;
  proxy?: LaunchOptions['proxy'];
  windowSize?: { width: number; height: number };
  extraArgs?: string[];
}

export async function launchBrowser(req: LaunchRequest): Promise<{ browser: Browser; resolved: ResolvedBrowser }> {
  const resolved = resolveBrowser(req.choice, req.customPath);
  const size = req.windowSize ?? { width: 1366, height: 900 };
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate,MediaRouter', `--window-size=${size.width},${size.height}`];
  if (req.hideBanner) args.push('--disable-blink-features=AutomationControlled');
  if (req.extraArgs) args.push(...req.extraArgs);
  const browser = await chromium.launch({
    executablePath: resolved.executablePath,
    headless: req.headless,
    args,
    ignoreDefaultArgs: req.hideBanner ? ['--enable-automation'] : undefined,
    proxy: req.proxy,
  });
  return { browser, resolved };
}

export function parseProxy(raw: string): LaunchOptions['proxy'] | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withScheme);
    return {
      server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { server: s };
  }
}
