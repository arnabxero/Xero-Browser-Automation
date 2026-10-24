import { useSyncExternalStore } from 'react';

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function navigate(path: string, replace = false) {
  const target = `#${path}`;
  if (replace) window.location.replace(target);
  else if (window.location.hash !== target) window.location.hash = path;
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, current);
  const [path, q = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function back(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}
