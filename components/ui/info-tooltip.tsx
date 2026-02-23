'use client';

import { useState } from 'react';

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [tapped, setTapped] = useState(false);

  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label="More information"
        onClick={() => setTapped((v) => !v)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-xs text-zinc-400 transition hover:border-cyan-400 hover:text-cyan-400"
      >
        ⓘ
      </button>
      <span
        className={`absolute bottom-full right-0 z-30 mb-2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-300 shadow-xl transition-opacity ${
          tapped
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-hover:opacity-100'
        }`}
      >
        {text}
      </span>
    </span>
  );
}
