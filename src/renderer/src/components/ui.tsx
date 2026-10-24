import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RPopover from '@radix-ui/react-popover';
import * as RSlider from '@radix-ui/react-slider';
import * as RSwitch from '@radix-ui/react-switch';
import * as RTooltip from '@radix-ui/react-tooltip';
import { Check, ChevronDown, LoaderCircle, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ── Buttons ────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'rec' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary: 'bg-raised text-ink border border-line hover:bg-raised-2 hover:border-line-strong',
  ghost: 'text-ink-2 hover:text-ink hover:bg-raised',
  subtle: 'bg-accent-soft text-accent hover:bg-accent-soft/80',
  danger: 'bg-fail-soft text-fail hover:bg-fail hover:text-white',
  rec: 'bg-rec text-white hover:brightness-110 shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-lg',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, disabled, ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 15;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle size={iconSize} className="spin" /> : Icon ? <Icon size={iconSize} strokeWidth={2} /> : null}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={2} className="opacity-70" />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'danger' | 'accent';
  shortcut?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', active, tone = 'default', shortcut, className, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        active ? 'bg-accent-soft text-accent' : tone === 'danger' ? 'text-ink-3 hover:bg-fail-soft hover:text-fail' : tone === 'accent' ? 'text-accent hover:bg-accent-soft' : 'text-ink-3 hover:bg-raised hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2} />
    </button>
  );
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {btn}
    </Tooltip>
  );
});

// ── Tooltip ────────────────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = 'top', shortcut }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; shortcut?: string }) {
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="fade-in z-[70] flex max-w-xs items-center gap-2 rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink shadow-pop"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('rounded border border-line bg-raised px-1 font-sans text-[10.5px] font-medium leading-4 text-ink-3', className)}>{children}</kbd>;
}

// ── Inputs ─────────────────────────────────────────────────────────────────

const FIELD = 'rounded-lg border border-line bg-sunken text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; icon?: LucideIcon; inputSize?: 'sm' | 'md' | 'lg' }>(function Input(
  { className, mono, icon: Icon, inputSize = 'md', ...rest },
  ref,
) {
  const h = inputSize === 'sm' ? 'h-7 text-[12.5px]' : inputSize === 'lg' ? 'h-11 text-[14px]' : 'h-8 text-[13px]';
  if (Icon) {
    return (
      <div className={cn('relative', className)}>
        <Icon size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
        <input ref={ref} className={cn(FIELD, 'w-full', h, 'pr-2.5 pl-8', mono && 'font-mono text-[12px]')} spellCheck={false} {...rest} />
      </div>
    );
  }
  const sized = /(^|\s)(w-|min-w-|flex-1)/.test(className ?? '');
  return <input ref={ref} className={cn(FIELD, !sized && 'w-full', h, 'px-2.5', mono && 'font-mono text-[12px]', className)} spellCheck={false} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ className, mono, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, 'w-full min-h-[72px] resize-y px-2.5 py-2 text-[13px] leading-relaxed', mono && 'font-mono text-[12px]', className)} spellCheck={false} {...rest} />;
});

export function Field({ label, hint, error, children, className, aside }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-2">
          {label && <label className="text-[12.5px] font-medium text-ink-2">{label}</label>}
          {aside}
        </div>
      )}
      {children}
      {error ? <p className="text-[12px] text-fail">{error}</p> : hint ? <p className="text-[12px] leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onChange(clamp(n));
    else setDraft(String(value));
  };
  return (
    <div className={cn('flex h-8 items-stretch overflow-hidden rounded-lg border border-line bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft', disabled && 'opacity-50', className)}>
      <button type="button" aria-label="Decrease" disabled={disabled} className="px-2 text-ink-3 hover:bg-raised hover:text-ink" onClick={() => onChange(clamp(value - step))}>
        <Minus size={13} />
      </button>
      <input
        aria-label={ariaLabel}
        disabled={disabled}
        className="tnum w-full min-w-0 bg-transparent text-center text-[13px] text-ink outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + step));
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value - step));
          }
        }}
      />
      {suffix && <span className="flex items-center pr-1 text-[12px] text-ink-3">{suffix}</span>}
      <button type="button" aria-label="Increase" disabled={disabled} className="px-2 text-ink-3 hover:bg-raised hover:text-ink" onClick={() => onChange(clamp(value + step))}>
        <Plus size={13} />
      </button>
    </div>
  );
}

// ── Switch / Slider / Segmented ────────────────────────────────────────────

export function Switch({ checked, onChange, disabled, label, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; ariaLabel?: string }) {
  const sw = (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="relative h-[18px] w-8 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <RSwitch.Thumb className="block h-3.5 w-3.5 translate-x-[2px] rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[16px]" />
    </RSwitch.Root>
  );
  if (!label) return sw;
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-ink">
      <span>{label}</span>
      {sw}
    </label>
  );
}

export function Slider({ value, onChange, min, max, step = 1, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; ariaLabel?: string }) {
  return (
    <RSlider.Root value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} className="relative flex h-5 w-full touch-none items-center select-none" aria-label={ariaLabel}>
      <RSlider.Track className="relative h-1 grow rounded-full bg-line-strong">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb className="block h-4 w-4 rounded-full border-2 border-accent bg-panel shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft" />
    </RSlider.Root>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: LucideIcon; title?: string }[];
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-lg border border-line bg-sunken p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
              active ? 'bg-raised-2 text-ink shadow-[0_1px_2px_rgb(0_0_0/0.25)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            {Icon && <Icon size={13} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Select (keyboard-friendly menu with radio items) ──────────────────────

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  className,
  size = 'md',
  ariaLabel,
  disabled,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  const Icon = current?.icon;
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-line bg-sunken text-left text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft data-[state=open]:border-accent disabled:opacity-50',
            size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-2.5 text-[13px]',
            className,
          )}
        >
          {Icon && <Icon size={14} className="shrink-0 text-ink-3" />}
          <span className={cn('min-w-0 flex-1 truncate', !current && 'text-ink-3')}>{current?.label ?? placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>
      </RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align="start" sideOffset={4} className="pop-in z-[60] max-h-[min(380px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-pop">
          <RMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
            {options.map((o) => (
              <RMenu.RadioItem
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-raised"
              >
                {o.icon && <o.icon size={14} className="shrink-0 text-ink-3" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11.5px] text-ink-3">{o.hint}</span>}
                </span>
                <RMenu.ItemIndicator>
                  <Check size={14} className="text-accent" />
                </RMenu.ItemIndicator>
              </RMenu.RadioItem>
            ))}
          </RMenu.RadioGroup>
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

// ── Menu ───────────────────────────────────────────────────────────────────

export function Menu({ trigger, children, align = 'end', side = 'bottom' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} side={side} sideOffset={4} className="pop-in z-[60] min-w-[200px] rounded-lg border border-line bg-panel p-1 shadow-pop">
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function MenuItem({ icon: Icon, children, onSelect, shortcut, tone, disabled, hint }: { icon?: LucideIcon; children: ReactNode; onSelect?: () => void; shortcut?: string; tone?: 'danger'; disabled?: boolean; hint?: ReactNode }) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] outline-none data-[disabled]:opacity-40',
        tone === 'danger' ? 'text-fail data-[highlighted]:bg-fail-soft' : 'text-ink data-[highlighted]:bg-raised',
      )}
    >
      {Icon && <Icon size={15} className={tone === 'danger' ? '' : 'text-ink-3'} />}
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {hint && <span className="block text-[11.5px] text-ink-3">{hint}</span>}
      </span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-ink-3">{children}</RMenu.Label>;
}

export function SubMenu({ label, icon: Icon, children }: { label: ReactNode; icon?: LucideIcon; children: ReactNode }) {
  return (
    <RMenu.Sub>
      <RMenu.SubTrigger className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-raised data-[state=open]:bg-raised">
        {Icon && <Icon size={15} className="text-ink-3" />}
        <span className="flex-1">{label}</span>
        <ChevronDown size={13} className="-rotate-90 text-ink-3" />
      </RMenu.SubTrigger>
      <RMenu.Portal>
        <RMenu.SubContent sideOffset={6} className="pop-in z-[61] min-w-[200px] rounded-lg border border-line bg-panel p-1 shadow-pop">
          {children}
        </RMenu.SubContent>
      </RMenu.Portal>
    </RMenu.Sub>
  );
}

// ── Popover ────────────────────────────────────────────────────────────────

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} side={side} sideOffset={6} collisionPadding={12} className={cn('pop-in z-[60] rounded-xl border border-line bg-panel shadow-pop focus:outline-none', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

// ── Dialog ─────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 520,
  icon: Icon,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  icon?: LucideIcon;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fade-in fixed inset-0 z-50 bg-[var(--scrim)]" />
        <RDialog.Content
          style={{ width: `min(${width}px, calc(100vw - 48px))` }}
          className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-64px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-panel shadow-pop focus:outline-none"
        >
          <div className="flex items-start gap-3 px-6 pt-5 pb-4">
            {Icon && (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon size={17} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <RDialog.Title className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-[13px] leading-relaxed text-ink-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button type="button" aria-label="Close" className="-mt-1 -mr-2 rounded-md p-1.5 text-ink-3 hover:bg-raised hover:text-ink">
                <X size={16} />
              </button>
            </RDialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Imperative confirm dialog. */
type ConfirmReq = { title: string; description?: ReactNode; confirm?: string; tone?: 'danger' | 'primary'; resolve: (v: boolean) => void };
let pushConfirm: ((r: ConfirmReq) => void) | null = null;

export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(window.confirm(opts.title));
    pushConfirm({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    pushConfirm = setReq;
    return () => {
      pushConfirm = null;
    };
  }, []);
  const close = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close(false)}
      title={req?.title ?? ''}
      description={req?.description}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button ref={btn} autoFocus variant={req?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {req?.confirm ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}

// ── Misc ───────────────────────────────────────────────────────────────────

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn('spin text-ink-3', className)} />;
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised text-ink-3">
        <Icon size={22} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className, icon: Icon }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'pass' | 'fail' | 'warn' | 'rec'; className?: string; icon?: LucideIcon }) {
  const tones = {
    neutral: 'bg-raised text-ink-2 border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    pass: 'bg-pass-soft text-pass border-transparent',
    fail: 'bg-fail-soft text-fail border-transparent',
    warn: 'bg-warn-soft text-warn border-transparent',
    rec: 'bg-rec-soft text-rec border-transparent',
  };
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-medium whitespace-nowrap', tones[tone], className)}>
      {Icon && <Icon size={12} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Section({ title, description, children, actions, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-line bg-panel', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line px-8 pt-6 pb-5">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-[70ch] text-[13px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'relative flex h-9 items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors',
            value === t.value ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent' : 'text-ink-3 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="tnum rounded bg-raised px-1 text-[11px] text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
