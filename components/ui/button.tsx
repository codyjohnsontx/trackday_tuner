'use client';

import {
  ButtonHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative isolate inline-flex items-center justify-center overflow-hidden rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary: 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300',
        secondary: 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800',
        ghost: 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800',
        destructive: 'border border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50',
      },
      size: {
        sm: 'min-h-11 px-3 py-2 text-xs',
        md: 'min-h-12 px-4 py-3 text-sm',
        lg: 'min-h-14 px-6 py-4 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

// Ink color of the press ripple, tuned per variant so it reads on the surface.
const RIPPLE_COLOR: Record<ButtonVariant, string> = {
  primary: 'rgba(6,34,42,0.45)',
  secondary: 'rgba(34,211,238,0.16)',
  ghost: 'rgba(34,211,238,0.16)',
  destructive: 'rgba(190,18,60,0.40)',
};

// Fill color of the hold-to-confirm progress sweep.
const HOLD_FILL: Record<ButtonVariant, string> = {
  primary: 'rgba(6,34,42,0.30)',
  secondary: 'rgba(34,211,238,0.20)',
  ghost: 'rgba(34,211,238,0.20)',
  destructive: 'rgba(190,18,60,0.55)',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  fullWidth?: boolean;
  loading?: boolean;
  asChild?: boolean;
  /** Ink ripple from the press point. On by default; opt out with `ripple={false}`. */
  ripple?: boolean;
  /** Show a checkmark pop in place of the spinner — the confirmed end of a save. */
  success?: boolean;
  /** Turn the button into a press-and-hold confirm; fires `onConfirm` when the hold completes. */
  holdToConfirm?: boolean;
  /** Called once a hold reaches full duration. Release early to cancel. */
  onConfirm?: () => void;
  /** How long the hold must be sustained, in ms (default 950). */
  holdDurationMs?: number;
  /** Label shown while the hold is in progress (defaults to `children`). */
  holdingLabel?: ReactNode;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

function Spinner() {
  return (
    <svg
      className="mr-2 h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckPop() {
  return (
    <span className="tt-btn-pop mr-2" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5l4.2 4.2L19 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  asChild = false,
  ripple = true,
  success = false,
  holdToConfirm = false,
  onConfirm,
  holdDurationMs = 950,
  holdingLabel,
  className,
  type = 'button',
  disabled,
  children,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const resolvedVariant = variant ?? 'primary';

  // Hooks must run unconditionally, before the asChild early return.
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);
  const [holding, setHolding] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const spawnRipple = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (prefersReducedMotion()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const id = ++rippleId.current;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setRipples((current) => [...current, { id, x, y, size }]);
    setTimeout(() => {
      setRipples((current) => current.filter((r) => r.id !== id));
    }, 620);
  }, []);

  const endHold = useCallback(() => {
    clearHold();
    setHolding(false);
  }, [clearHold]);

  const startHold = useCallback(() => {
    if (isDisabled) return;
    clearHold();
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
      onConfirm?.();
    }, holdDurationMs);
  }, [clearHold, holdDurationMs, isDisabled, onConfirm]);

  // asChild renders through a Slot (e.g. a Link) — keep it purely presentational.
  if (asChild) {
    const handleClick = (event: MouseEvent<HTMLElement>) => {
      if (isDisabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      props.onClick?.(event as MouseEvent<HTMLButtonElement>);
    };
    const handleClickCapture = (event: MouseEvent<HTMLElement>) => {
      if (isDisabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      props.onClickCapture?.(event as MouseEvent<HTMLButtonElement>);
    };
    const slotProps = {
      ...(props as object),
      disabled: isDisabled,
      'aria-disabled': isDisabled,
      'aria-busy': loading,
      'data-disabled': isDisabled ? '' : undefined,
      tabIndex: isDisabled ? -1 : undefined,
      onClickCapture: handleClickCapture,
      onClick: handleClick,
    };

    return (
      <Slot
        {...slotProps}
        className={cn(
          buttonVariants({ variant, size }),
          fullWidth && 'w-full',
          isDisabled && 'pointer-events-none',
          className,
        )}
      >
        {loading && <Spinner />}
        <Slottable>{children}</Slottable>
      </Slot>
    );
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!isDisabled) {
      if (ripple && !holdToConfirm) {
        spawnRipple(event);
      }
      if (holdToConfirm) {
        // Keep the gesture pinned to this element so a finger drift or an OS
        // long-press callout can't interrupt the confirm timer mid-hold.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // setPointerCapture can throw if the pointer is already gone — ignore.
        }
        startHold();
      }
    }
    onPointerDown?.(event);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (holdToConfirm) endHold();
    onPointerUp?.(event);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    if (holdToConfirm) endHold();
    onPointerLeave?.(event);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    if (holdToConfirm) endHold();
    onPointerCancel?.(event);
  };

  // Keyboard parity for hold-to-confirm: hold Enter/Space to confirm, release to
  // cancel. preventDefault suppresses the native click so the hold drives it.
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (holdToConfirm && !isDisabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (!event.repeat && !holdTimer.current) startHold();
    }
    onKeyDown?.(event);
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (holdToConfirm && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      endHold();
    }
    onKeyUp?.(event);
  };

  const label = holdToConfirm && holding && holdingLabel != null ? holdingLabel : children;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading}
      className={cn(
        buttonVariants({ variant, size }),
        fullWidth && 'w-full',
        holdToConfirm && 'touch-none select-none',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      {...props}
    >
      {/* Decorative layers sit at z-index -1 (below the label) inside the button's
          own stacking context, so text stays legible without wrapping children. */}
      {holdToConfirm && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 -z-10"
          style={{
            width: holding ? '100%' : '0%',
            background: HOLD_FILL[resolvedVariant],
            // Respect prefers-reduced-motion: no animated sweep, the fill just snaps.
            transition: reducedMotion
              ? 'none'
              : holding
                ? `width ${holdDurationMs}ms linear`
                : 'width 0.25s ease',
          }}
        />
      )}
      {ripple &&
        !holdToConfirm &&
        ripples.map((r) => (
          <span
            key={r.id}
            className="tt-ripple -z-10"
            style={{
              left: r.x,
              top: r.y,
              width: r.size,
              height: r.size,
              marginLeft: -r.size / 2,
              marginTop: -r.size / 2,
              background: RIPPLE_COLOR[resolvedVariant],
            }}
          />
        ))}
      {success ? <CheckPop /> : loading ? <Spinner /> : null}
      {label}
    </button>
  );
}

export { buttonVariants };
