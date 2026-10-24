import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  parts.push(k);
  return parts.join('+');
}

/** Shortcuts that keep their usual text-editing meaning inside fields. */
const TEXT_COMBOS = new Set(['mod+a', 'mod+c', 'mod+v', 'mod+x', 'mod+z', 'mod+y', 'mod+shift+z', 'mod+d']);

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * Keys like "mod+k", "shift+?" or "delete". Combos with mod work everywhere;
 * plain keys only work outside fields and widgets.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const fn = ref.current[combo];
      if (!fn) return;
      if ((!combo.startsWith('mod+') || TEXT_COMBOS.has(combo)) && isTyping(e)) return;
      if (combo === 'mod+c' && window.getSelection()?.toString()) return;
      // Plain keys only act on the page itself or inside a [data-hotkeys] region, never inside menus or widgets.
      const t = e.target as HTMLElement | null;
      if (!combo.startsWith('mod+') && !(t === document.body || t?.closest?.('[data-hotkeys]'))) return;
      // Open dialogs and popovers own the keyboard.
      if (combo !== 'mod+k' && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
