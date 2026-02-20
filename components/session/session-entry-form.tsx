'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  getDefaultDraft,
  getModulesForMode,
  ModuleDefinition,
  SessionDraft,
  SessionModuleType,
  VehicleMode,
} from '@/lib/modules';
import { clearSessionDraft, loadSessionDraft, saveSessionDraft } from '@/lib/session-draft';

const container = 'rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-xl';
const field =
  'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500';
const button = 'rounded-xl px-4 py-3 text-sm font-semibold transition';

function renderField(
  module: ModuleDefinition,
  fieldKey: string,
  value: string,
  setValue: (next: string) => void,
  inputType: 'number' | 'text' | 'textarea',
  label: string,
  placeholder?: string,
  unit?: string
) {
  const id = `${module.moduleType}_${fieldKey}`;

  return (
    <label key={id} htmlFor={id} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      {inputType === 'textarea' ? (
        <textarea
          id={id}
          className={`${field} min-h-24`}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            id={id}
            className={field}
            type={inputType}
            inputMode={inputType === 'number' ? 'decimal' : 'text'}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
          {unit ? <span className="text-xs text-zinc-400">{unit}</span> : null}
        </div>
      )}
    </label>
  );
}

export default function SessionEntryForm() {
  const [draft, setDraft] = useState<SessionDraft>(() => getDefaultDraft('motorcycle'));
  const modules = useMemo(() => getModulesForMode(draft.vehicleMode), [draft.vehicleMode]);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    const persisted = loadSessionDraft();
    if (persisted) {
      setDraft(persisted);
    }
  }, []);

  function updateCore<K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function switchVehicleMode(nextMode: VehicleMode) {
    setDraft((prev) => {
      const nextBase = getDefaultDraft(nextMode);

      return {
        ...nextBase,
        trackId: prev.trackId,
        notes: prev.notes,
        sessionDate: prev.sessionDate,
      };
    });
  }

  function setModuleEnabled(moduleType: SessionModuleType, enabled: boolean) {
    setDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [moduleType]: {
          ...prev.modules[moduleType],
          enabled,
          values: enabled ? prev.modules[moduleType]?.values ?? {} : {},
        },
      },
    }));
  }

  function setModuleAdvanced(moduleType: SessionModuleType, showAdvanced: boolean) {
    setDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [moduleType]: {
          ...prev.modules[moduleType],
          showAdvanced,
          values: prev.modules[moduleType]?.values ?? {},
          enabled: prev.modules[moduleType]?.enabled ?? false,
        },
      },
    }));
  }

  function setModuleField(moduleType: SessionModuleType, key: string, value: string) {
    setDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [moduleType]: {
          ...prev.modules[moduleType],
          enabled: prev.modules[moduleType]?.enabled ?? true,
          showAdvanced: prev.modules[moduleType]?.showAdvanced ?? false,
          values: {
            ...prev.modules[moduleType]?.values,
            [key]: value,
          },
        },
      },
    }));
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSessionDraft(draft);
    setStatusMessage('Draft saved locally. Partial entries are allowed.');
  }

  function handleClearDraft() {
    clearSessionDraft();
    setDraft(getDefaultDraft(draft.vehicleMode));
    setStatusMessage('Draft cleared.');
  }

  return (
    <form className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8" onSubmit={handleSave}>
      <section className={container}>
        <h2 className="text-lg font-semibold text-zinc-100">New Session</h2>
        <p className="mt-1 text-sm text-zinc-400">Trackside-first entry. Save anytime, even with missing values.</p>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-zinc-900 p-1">
          {(['motorcycle', 'car'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${button} ${
                draft.vehicleMode === mode ? 'bg-cyan-500 text-zinc-950' : 'bg-transparent text-zinc-200'
              }`}
              onClick={() => switchVehicleMode(mode)}
            >
              {mode === 'motorcycle' ? 'Motorcycle' : 'Car'}
            </button>
          ))}
        </div>
      </section>

      <section className={`${container} space-y-3`}>
        <h3 className="text-base font-semibold text-zinc-100">Session Basics</h3>

        <label htmlFor="vehicle_id" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Vehicle (nickname or id)</span>
          <input
            id="vehicle_id"
            className={field}
            value={draft.vehicleId}
            placeholder="R6 Track"
            onChange={(event) => updateCore('vehicleId', event.target.value)}
          />
        </label>

        <label htmlFor="track_id" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Track</span>
          <input
            id="track_id"
            className={field}
            value={draft.trackId}
            placeholder="COTA"
            onChange={(event) => updateCore('trackId', event.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label htmlFor="session_date" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Date</span>
            <input
              id="session_date"
              className={field}
              type="date"
              value={draft.sessionDate}
              onChange={(event) => updateCore('sessionDate', event.target.value)}
            />
          </label>

          <label htmlFor="session_number" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Session # (optional)</span>
            <input
              id="session_number"
              className={field}
              inputMode="numeric"
              value={draft.sessionNumber}
              placeholder="3"
              onChange={(event) => updateCore('sessionNumber', event.target.value)}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label htmlFor="weather" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Weather (optional)</span>
            <input
              id="weather"
              className={field}
              value={draft.weather}
              placeholder="Sunny"
              onChange={(event) => updateCore('weather', event.target.value)}
            />
          </label>

          <label htmlFor="temperature_f" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Temp (F, optional)</span>
            <input
              id="temperature_f"
              className={field}
              inputMode="decimal"
              value={draft.temperatureF}
              placeholder="87"
              onChange={(event) => updateCore('temperatureF', event.target.value)}
            />
          </label>
        </div>

        <label htmlFor="track_condition" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Track condition (optional)</span>
          <input
            id="track_condition"
            className={field}
            value={draft.trackCondition}
            placeholder="Green track / windy / damp exits"
            onChange={(event) => updateCore('trackCondition', event.target.value)}
          />
        </label>

        <label htmlFor="session_notes" className="block space-y-2">
          <span className="text-sm font-medium text-zinc-200">Session notes</span>
          <textarea
            id="session_notes"
            className={`${field} min-h-24`}
            value={draft.notes}
            placeholder="What changed, what felt better/worse..."
            onChange={(event) => updateCore('notes', event.target.value)}
          />
        </label>
      </section>

      {modules.map((module) => {
        const moduleState = draft.modules[module.moduleType] ?? {
          enabled: false,
          showAdvanced: false,
          values: {},
        };

        const visibleFields = module.fields.filter(
          (moduleField) => !moduleField.advanced || moduleState.showAdvanced
        );

        return (
          <section key={module.moduleType} className={`${container} space-y-4`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-zinc-100">{module.label}</h3>
              <button
                type="button"
                className={`${button} ${
                  moduleState.enabled
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'border border-zinc-700 bg-zinc-900 text-zinc-200'
                }`}
                onClick={() => setModuleEnabled(module.moduleType, !moduleState.enabled)}
              >
                {moduleState.enabled ? 'Remove module' : 'Add module'}
              </button>
            </div>

            {moduleState.enabled ? (
              <>
                <button
                  type="button"
                  className={`${button} w-full border border-zinc-700 bg-zinc-900 text-zinc-200`}
                  onClick={() => setModuleAdvanced(module.moduleType, !moduleState.showAdvanced)}
                >
                  {moduleState.showAdvanced ? 'Hide advanced fields' : 'Show advanced fields'}
                </button>

                <div className="space-y-3">
                  {visibleFields.map((moduleField) =>
                    renderField(
                      module,
                      moduleField.key,
                      moduleState.values[moduleField.key] ?? '',
                      (next) => setModuleField(module.moduleType, moduleField.key, next),
                      moduleField.input,
                      moduleField.label,
                      moduleField.placeholder,
                      moduleField.unit
                    )
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-400">Module disabled for this session.</p>
            )}
          </section>
        );
      })}

      <div className={`${container} space-y-3`}>
        <button type="submit" className={`${button} w-full bg-cyan-500 text-zinc-950`}>
          Save Draft
        </button>
        <button
          type="button"
          className={`${button} w-full border border-zinc-700 bg-zinc-900 text-zinc-200`}
          onClick={handleClearDraft}
        >
          Clear Draft
        </button>
        {statusMessage ? <p className="text-sm text-zinc-300">{statusMessage}</p> : null}
      </div>
    </form>
  );
}
