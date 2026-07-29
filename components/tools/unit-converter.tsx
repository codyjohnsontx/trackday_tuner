'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  converterCategories,
  convertValue,
  corePresetPairs,
  formatConverterResult,
  parseConverterInput,
  type ConverterCategory,
  type ConverterPair,
} from '@/lib/converter';
import {
  loadRecentPairs,
  recordRecentPair,
  saveRecentPairs,
} from '@/lib/converter-recents';

const initialPair: ConverterPair = corePresetPairs[0];

export function UnitConverter() {
  const [category, setCategory] = useState<ConverterCategory>(initialPair.category);
  const [fromUnit, setFromUnit] = useState(initialPair.fromUnit);
  const [toUnit, setToUnit] = useState(initialPair.toUnit);
  const [inputValue, setInputValue] = useState('');
  const [recentPairs, setRecentPairs] = useState<ConverterPair[]>([]);
  const [copyMessage, setCopyMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const unitsForCategory = useMemo(
    () => converterCategories.find((item) => item.id === category)?.units ?? [],
    [category],
  );

  const convertedValue = useMemo(
    () => convertValue(category, fromUnit, toUnit, parseConverterInput(inputValue)),
    [category, fromUnit, toUnit, inputValue],
  );

  useEffect(() => {
    setRecentPairs(loadRecentPairs());
  }, []);

  useEffect(() => {
    if (!unitsForCategory.includes(fromUnit) || !unitsForCategory.includes(toUnit)) {
      const nextFrom = unitsForCategory[0] ?? '';
      const nextTo = unitsForCategory[1] ?? unitsForCategory[0] ?? '';
      setFromUnit(nextFrom);
      setToUnit(nextTo);
    }
  }, [unitsForCategory, fromUnit, toUnit]);

  function selectPair(pair: ConverterPair) {
    setCategory(pair.category);
    setFromUnit(pair.fromUnit);
    setToUnit(pair.toUnit);
    setCopyMessage(null);
  }

  function swapUnits() {
    setFromUnit(toUnit);
    setToUnit(fromUnit);
    setCopyMessage(null);
  }

  function markRecent(pair: ConverterPair) {
    setRecentPairs((current) => {
      const next = recordRecentPair(current, pair);
      saveRecentPairs(next);
      return next;
    });
  }

  function handleConvertNow() {
    markRecent({ category, fromUnit, toUnit });
  }

  async function handleCopy() {
    if (convertedValue === null) return;
    const text = `${formatConverterResult(convertedValue)} ${toUnit}`;
    try {
      await navigator.clipboard.writeText(text);
      markRecent({ category, fromUnit, toUnit });
      setCopyMessage({ text: 'Copied', ok: true });
    } catch {
      setCopyMessage({ text: 'Copy failed', ok: false });
    }
    setTimeout(() => setCopyMessage(null), 1200);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Unit"
        muted="Converter"
        sub="Quick conversions for trackside setup changes."
      />

      <section className="space-y-2 rounded-card bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Core Presets
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {corePresetPairs.map((pair) => (
            <Button
              key={`${pair.category}:${pair.fromUnit}:${pair.toUnit}`}
              type="button"
              variant={
                category === pair.category &&
                fromUnit === pair.fromUnit &&
                toUnit === pair.toUnit
                  ? 'primary'
                  : 'secondary'
              }
              className="text-xs"
              onClick={() => {
                selectPair(pair);
                markRecent(pair);
              }}
            >
              {pair.fromUnit} ↔ {pair.toUnit}
            </Button>
          ))}
        </div>
      </section>

      {recentPairs.length > 0 ? (
        <section className="space-y-2 rounded-card bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Recent (Top 5)
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {recentPairs.map((pair) => (
              <Button
                key={`recent:${pair.category}:${pair.fromUnit}:${pair.toUnit}`}
                type="button"
                variant="secondary"
                className="text-xs"
                onClick={() => {
                  selectPair(pair);
                  markRecent(pair);
                }}
              >
                {pair.fromUnit} → {pair.toUnit}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-card bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Converter
        </h2>

        <div className="space-y-1">
          <label htmlFor="converter-category" className="block text-sm font-medium text-ink-dim">
            Category
          </label>
          <select
            id="converter-category"
            className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            value={category}
            onChange={(event) => setCategory(event.target.value as ConverterCategory)}
          >
            {converterCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="converter-from" className="block text-sm font-medium text-ink-dim">
              From
            </label>
            <select
              id="converter-from"
              className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
              value={fromUnit}
              onChange={(event) => setFromUnit(event.target.value)}
            >
              {unitsForCategory.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="converter-to" className="block text-sm font-medium text-ink-dim">
              To
            </label>
            <select
              id="converter-to"
              className="w-full rounded-row bg-surface-3 px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
              value={toUnit}
              onChange={(event) => setToUnit(event.target.value)}
            >
              {unitsForCategory.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Input
          label="Value"
          type="text"
          inputMode="decimal"
          placeholder="Enter value"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" fullWidth onClick={swapUnits}>
            Swap
          </Button>
          <Button type="button" fullWidth onClick={handleConvertNow}>
            Convert + Save Pair
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-card bg-surface-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Result</p>
        <p className="text-3xl font-bold text-ink">
          {formatConverterResult(convertedValue)}{' '}
          <span className="text-lg font-medium text-ink-dim">{toUnit}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleCopy} disabled={convertedValue === null}>
            Copy
          </Button>
          {copyMessage ? (
            <span
              className={cn('text-sm', copyMessage.ok ? 'text-faster' : 'text-slower')}
              role="status"
            >
              {copyMessage.text}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
