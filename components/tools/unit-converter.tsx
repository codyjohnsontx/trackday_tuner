'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [copyMessage, setCopyMessage] = useState('');

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
    setCopyMessage('');
  }

  function swapUnits() {
    setFromUnit(toUnit);
    setToUnit(fromUnit);
    setCopyMessage('');
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
      setCopyMessage('Copied');
    } catch {
      setCopyMessage('Copy failed');
    }
    setTimeout(() => setCopyMessage(''), 1200);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">Unit Converter</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Quick conversions for trackside setup changes.
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
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
        <section className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
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

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Converter
        </h2>

        <div className="space-y-1">
          <label htmlFor="converter-category" className="block text-sm font-medium text-zinc-300">
            Category
          </label>
          <select
            id="converter-category"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
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
            <label htmlFor="converter-from" className="block text-sm font-medium text-zinc-300">
              From
            </label>
            <select
              id="converter-from"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
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
            <label htmlFor="converter-to" className="block text-sm font-medium text-zinc-300">
              To
            </label>
            <select
              id="converter-to"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none"
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

      <section className="space-y-3 rounded-2xl border border-cyan-500/30 bg-cyan-400/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Result</p>
        <p className="text-3xl font-bold text-zinc-100">
          {formatConverterResult(convertedValue)}{' '}
          <span className="text-lg font-medium text-zinc-300">{toUnit}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleCopy} disabled={convertedValue === null}>
            Copy
          </Button>
          {copyMessage ? <span className="text-sm text-emerald-300">{copyMessage}</span> : null}
        </div>
      </section>
    </div>
  );
}
