'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="More information"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-row border border-white/10 text-xs text-ink-dim transition hover:border-signal/30 hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            ⓘ
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            align="end"
            sideOffset={8}
            className={cn(
              'z-30 w-64 rounded-row bg-surface p-3 text-xs leading-relaxed text-ink-dim shadow-xl',
              'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
            )}
          >
            {text}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
