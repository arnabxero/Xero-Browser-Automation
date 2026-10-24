// Messages exchanged between the injected recorder and the main process.

import type { FieldInfo, Modifier, Target } from '../shared/types';

export type PickMode = 'pick' | 'assertText' | 'assertVisible' | 'assertValue' | 'extract' | 'hover';
export type RecorderMode = 'idle' | 'record' | PickMode;

export interface PageState {
  recording: boolean;
  paused: boolean;
  mode: RecorderMode;
  toolbar: boolean;
  recordScroll: boolean;
  recordTab: boolean;
  highlight: boolean;
  startedAt?: number;
  count: number;
}

export type RecordedAction =
  | { kind: 'click'; target: Target; button: 'left' | 'right' | 'middle'; clickCount: number; modifiers: Modifier[]; position?: { x: number; y: number }; textEntry?: boolean }
  | { kind: 'fill'; target: Target; value: string; field: FieldInfo }
  | { kind: 'select'; target: Target; values: string[]; labels: string[]; field: FieldInfo }
  | { kind: 'check' | 'uncheck'; target: Target; field: FieldInfo }
  | { kind: 'press'; target?: Target; key: string; modifiers: Modifier[] }
  | { kind: 'hover'; target: Target }
  | { kind: 'dragDrop'; target: Target; destination: Target }
  | { kind: 'scroll'; target?: Target; x: number; y: number }
  | { kind: 'assert'; target: Target; assert: { kind: 'text' | 'visible' | 'value'; op: 'contains' | 'equals'; expected?: string } }
  | { kind: 'extract'; target: Target; source: 'text' | 'value'; variable: string };

export type PageMessage =
  | { t: 'hello' }
  | { t: 'action'; a: RecordedAction; url: string; time: number }
  | { t: 'cmd'; cmd: 'pause' | 'resume' | 'stop' | 'addWait' | 'screenshot' | 'assertUrl' | 'assertTitle' | 'cancelPick' | 'setMode'; mode?: RecorderMode }
  | { t: 'picked'; target: Target };
