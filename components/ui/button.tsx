import { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]',
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

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  fullWidth?: boolean;
  loading?: boolean;
  asChild?: boolean;
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

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  asChild = false,
  className,
  type = 'button',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

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

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading}
      className={cn(buttonVariants({ variant, size }), fullWidth && 'w-full', className)}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export { buttonVariants };
