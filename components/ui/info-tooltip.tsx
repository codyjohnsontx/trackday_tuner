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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-600 text-xs text-zinc-400 transition hover:border-cyan-400 hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
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
              'z-30 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-300 shadow-xl',
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
