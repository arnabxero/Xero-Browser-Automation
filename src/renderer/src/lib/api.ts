import type { XeroApi } from '@shared/api';

declare global {
  interface Window {
    xero: XeroApi;
  }
}

export const api: XeroApi = window.xero;

/** Strips Electron's "Error invoking remote method" prefix. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim() || 'Something went wrong';
}
