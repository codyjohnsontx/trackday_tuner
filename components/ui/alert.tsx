'use client';

import { HTMLAttributes, ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  dismissible?: boolean;
  title?: string;
}

const variantConfig: Record<AlertVariant, { container: string; icon: string; iconPath: ReactNode }> = {
  error: {
    container: 'border border-rose-800/50 bg-rose-950/40 text-rose-200',
    icon: 'text-rose-400',
    iconPath: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    ),
  },
  success: {
    container: 'border border-emerald-800/50 bg-emerald-950/40 text-emerald-200',
    icon: 'text-emerald-400',
    iconPath: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
  },
  warning: {
    container: 'border border-amber-800/50 bg-amber-950/40 text-amber-200',
    icon: 'text-amber-400',
    iconPath: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
      />
    ),
  },
  info: {
    container: 'border border-blue-800/50 bg-blue-950/40 text-blue-200',
    icon: 'text-blue-400',
    iconPath: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    ),
  },
};

export function Alert({ variant = 'info', dismissible = false, title, className, children, ...props }: AlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const config = variantConfig[variant];

  if (dismissed) return null;

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-xl p-3 text-sm', config.container, className)}
      {...props}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className={cn('mt-0.5 h-4 w-4 shrink-0', config.icon)}
        aria-hidden="true"
      >
        {config.iconPath}
      </svg>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-auto shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}
