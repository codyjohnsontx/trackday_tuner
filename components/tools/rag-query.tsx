'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RagCitation, RagQueryResponse } from '@/lib/rag/types';

interface RagErrorResponse {
  error?: string;
  retry_after_seconds?: number;
}

function isRagErrorResponse(payload: RagQueryResponse | RagErrorResponse): payload is RagErrorResponse {
  return 'error' in payload;
}

const initialFilters = {
  track: '',
  bike: '',
  dateFrom: '',
  dateTo: '',
};

function formatRetryAfter(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function getErrorMessage(status: number, payload: RagQueryResponse | RagErrorResponse): string {
  if (!isRagErrorResponse(payload)) {
    return 'Unable to answer question.';
  }

  const baseMessage = payload.error ?? 'Unable to answer question.';
  if (status === 429 && typeof payload.retry_after_seconds === 'number') {
    return `${baseMessage} Retry in ${formatRetryAfter(payload.retry_after_seconds)}.`;
  }

  return baseMessage;
}

export function RagQuery() {
  const [question, setQuestion] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState<RagQueryResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const hasAnswer = Boolean(result?.answer);
  const hasFilters = useMemo(
    () => Object.values(filters).some((value) => value.trim().length > 0),
    [filters]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/rag/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          question,
          filters: hasFilters
            ? {
                ...(filters.track.trim() ? { track: filters.track.trim() } : {}),
                ...(filters.bike.trim() ? { bike: filters.bike.trim() } : {}),
                ...(filters.dateFrom.trim() ? { dateFrom: filters.dateFrom.trim() } : {}),
                ...(filters.dateTo.trim() ? { dateTo: filters.dateTo.trim() } : {}),
              }
            : undefined,
        }),
      });

      const payload = (await response.json()) as RagQueryResponse | RagErrorResponse;

      if (!response.ok) {
        setResult(null);
        setError(getErrorMessage(response.status, payload));
        return;
      }

      setResult(payload as RagQueryResponse);
    } catch {
      setError('Unable to reach the RAG query route.');
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }

  function updateFilter(key: keyof typeof initialFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">AI Tuning Q&amp;A</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ask grounded setup questions using Track Tuner knowledge articles and seeded session history.
        </p>
      </section>

      <form className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="rag-question" className="block text-sm font-medium text-zinc-200">
            Question
          </label>
          <textarea
            id="rag-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What should I check first if the bike is pushing mid-corner?"
            className="min-h-32 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          <p className="text-xs text-zinc-500">Answers are constrained to the provided Track Tuner context.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Track (optional)</span>
            <input
              value={filters.track}
              onChange={(event) => updateFilter('track', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              placeholder="Road America"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Bike / Car (optional)</span>
            <input
              value={filters.bike}
              onChange={(event) => updateFilter('bike', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              placeholder="Yamaha R6"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Date from (optional)</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => updateFilter('dateFrom', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Date to (optional)</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => updateFilter('dateTo', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            />
          </label>
        </div>

        <Button type="submit" fullWidth disabled={isLoading}>
          {isLoading ? 'Searching...' : 'Ask Track Tuner'}
        </Button>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      </form>

      {hasAnswer ? (
        <section className="space-y-4 rounded-2xl border border-cyan-500/30 bg-cyan-400/10 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Answer</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">{result?.answer}</p>
          </div>

          {result?.missing_info.length ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Missing Info</p>
              <ul className="space-y-1 text-sm text-zinc-300">
                {result.missing_info.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-500">
          Ask a question to see a grounded answer with citations.
        </section>
      )}

      {result?.citations.length ? (
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Citations</h2>
          <div className="space-y-3">
            {result.citations.map((citation, index) => (
              <CitationCard key={`${citation.source_id}:${index}`} citation={citation} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CitationCard({ citation }: { citation: RagCitation }) {
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
      <summary className="cursor-pointer list-none space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            {citation.source_type === 'knowledge_base' ? 'Knowledge Base' : 'Session Log'}
          </span>
          <span className="text-xs text-zinc-500">Score {citation.score.toFixed(3)}</span>
        </div>
        <p className="text-sm font-semibold text-zinc-100">{citation.title}</p>
        <p className="text-sm text-zinc-400">{citation.snippet}</p>
      </summary>
      <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        Source ID: {citation.source_id}
      </div>
    </details>
  );
}
