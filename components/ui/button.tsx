import { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
}

const variantClassMap: Record<ButtonVariant, string> = {
  primary: 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300 active:scale-[0.98]',
  secondary: 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 active:scale-[0.98]',
  ghost: 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 active:scale-[0.98]',
  destructive: 'border border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50 active:scale-[0.98]',
};

const sizeClassMap: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-3 py-2 text-xs',
  md: 'min-h-12 px-4 py-3 text-sm',
  lg: 'min-h-14 px-6 py-4 text-base',
};

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
  className = '',
  type = 'button',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 ${variantClassMap[variant]} ${sizeClassMap[size]} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
