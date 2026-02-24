import { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

const variantClassMap: Record<ButtonVariant, string> = {
  primary: 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300',
  secondary: 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800',
};

export function Button({
  variant = 'primary',
  fullWidth = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 ${variantClassMap[variant]} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
      {...props}
    />
  );
}
