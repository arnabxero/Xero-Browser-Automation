import {
  ArrowLeft,
  ArrowRight,
  AppWindow,
  Ban,
  Binary,
  Building2,
  Calendar,
  Camera,
  CircleCheck,
  CircleDot,
  CircleX,
  CodeXml,
  CreditCard,
  Crosshair,
  Fingerprint,
  Globe,
  Hand,
  Hourglass,
  Keyboard,
  ListChecks,
  ListFilter,
  LoaderCircle,
  MapPin,
  MessageSquare,
  MousePointer2,
  MousePointerClick,
  Move,
  Pause,
  RotateCw,
  ScrollText,
  ShoppingBag,
  SquareCheck,
  SquareDashedMousePointer,
  Text,
  TextCursorInput,
  Timer,
  TriangleAlert,
  Upload,
  User,
  Variable,
  Wifi,
  X,
  AtSign,
  Shuffle,
  Sparkles,
  CircleMinus,
  type LucideIcon,
} from 'lucide-react';
import type { DataCategory } from '@shared/data/catalog';
import type { IterationStatus, RunStatus, StepStatus, StepType } from '@shared/types';
import { Badge, cn } from './ui';

export const STEP_ICONS: Record<StepType, LucideIcon> = {
  navigate: Globe,
  click: MousePointerClick,
  hover: MousePointer2,
  fill: TextCursorInput,
  press: Keyboard,
  select: ListFilter,
  check: SquareCheck,
  uncheck: SquareDashedMousePointer,
  upload: Upload,
  dragDrop: Move,
  scroll: ScrollText,
  wait: Timer,
  waitFor: Hourglass,
  assert: ListChecks,
  extract: Variable,
  setVariable: Variable,
  screenshot: Camera,
  script: CodeXml,
  newTab: AppWindow,
  closeTab: X,
  goBack: ArrowLeft,
  goForward: ArrowRight,
  reload: RotateCw,
  dialog: MessageSquare,
};

export const CATEGORY_ICONS: Record<DataCategory, LucideIcon> = {
  person: User,
  contact: AtSign,
  address: MapPin,
  company: Building2,
  finance: CreditCard,
  datetime: Calendar,
  number: Binary,
  text: Text,
  identifier: Fingerprint,
  commerce: ShoppingBag,
  web: Wifi,
  choice: Shuffle,
  custom: Sparkles,
};

export function StepStatusIcon({ status, size = 15, className }: { status?: StepStatus; size?: number; className?: string }) {
  switch (status) {
    case 'running':
      return <LoaderCircle size={size} className={cn('spin text-accent', className)} aria-label="Running" />;
    case 'passed':
      return <CircleCheck size={size} className={cn('text-pass', className)} aria-label="Passed" />;
    case 'failed':
      return <CircleX size={size} className={cn('text-fail', className)} aria-label="Failed" />;
    case 'warning':
      return <TriangleAlert size={size} className={cn('text-warn', className)} aria-label="Warning" />;
    case 'skipped':
      return <CircleMinus size={size} className={cn('text-ink-3', className)} aria-label="Skipped" />;
    case 'pending':
      return <Pause size={size} className={cn('text-warn', className)} aria-label="Paused" />;
    default:
      return null;
  }
}

const RUN_STATUS: Record<RunStatus | IterationStatus, { label: string; tone: 'neutral' | 'accent' | 'pass' | 'fail' | 'warn'; icon: LucideIcon }> = {
  queued: { label: 'Queued', tone: 'neutral', icon: Hourglass },
  pending: { label: 'Waiting', tone: 'neutral', icon: Hourglass },
  running: { label: 'Running', tone: 'accent', icon: LoaderCircle },
  paused: { label: 'Paused', tone: 'warn', icon: Pause },
  passed: { label: 'Passed', tone: 'pass', icon: CircleCheck },
  failed: { label: 'Failed', tone: 'fail', icon: CircleX },
  stopped: { label: 'Stopped', tone: 'warn', icon: Ban },
  error: { label: 'Error', tone: 'fail', icon: TriangleAlert },
};

export function RunStatusBadge({ status, className }: { status: RunStatus | IterationStatus; className?: string }) {
  const s = RUN_STATUS[status];
  return (
    <Badge tone={s.tone} className={className}>
      <s.icon size={12} strokeWidth={2.2} className={status === 'running' ? 'spin' : undefined} />
      {s.label}
    </Badge>
  );
}

export function runStatusLabel(status: RunStatus | IterationStatus) {
  return RUN_STATUS[status].label;
}

export const PICK_ICON = Crosshair;
export const HAND_ICON = Hand;
export const DOT_ICON = CircleDot;
