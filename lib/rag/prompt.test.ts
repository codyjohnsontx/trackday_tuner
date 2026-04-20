import { describe, expect, it } from 'vitest';
import {
  buildMessages,
  buildUserPrompt,
  DISCLAIMER_NOTE,
  ONE_CHANGE_NOTE,
  SYSTEM_PROMPT,
} from '@/lib/rag/prompt';
import type { KnowledgeChunk, RetrievedChunk } from '@/lib/rag/types';
import type { Session, Vehicle } from '@/types';

function vehicle(): Vehicle {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: 'user-1',
    nickname: 'R6 Track',
    type: 'motorcycle',
    year: 2020,
    make: 'Yamaha',
    model: 'YZF-R6',
    photo_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function session(partial: Partial<Session> = {}): Session {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    user_id: 'user-1',
    vehicle_id: '11111111-1111-1111-1111-111111111111',
    track_id: null,
    track_name: 'Thunderhill',
    date: '2026-04-01',
    start_time: '09:00:00',
    session_number: 2,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC2', pressure: '30' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '25' },
      condition: 'scrubbed',
    },
    suspension: {
      front: { preload: '3', compression: '8', rebound: '10', direction: 'out' },
      rear: { preload: '4', compression: '9', rebound: '11', direction: 'out' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: 'Front pushed mid-corner.',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  };
}

function chunk(): KnowledgeChunk {
  return {
    id: 'docs/knowledge-base/tires/pressure-basics.md#01',
    source: 'docs/knowledge-base/tires/pressure-basics.md',
    heading: 'Common symptoms',
    vehicle_type: 'both',
    topic: 'tires',
    summary: null,
    text: 'Front pushing mid-corner after a pressure increase: drop 0.5 psi.',
    embedding: [],
  };
}

describe('buildUserPrompt', () => {
  const retrieved: RetrievedChunk[] = [{ chunk: chunk(), score: 0.87 }];

  it('includes the question, vehicle, current session, and knowledge snippets', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Front pushes mid-corner after +1 psi.',
      symptoms: ['understeer_mid'],
      changeIntent: 'stability_over_entry',
      temperatureC: 24,
      retrieved,
    });
    expect(prompt).toContain('Front pushes mid-corner after +1 psi.');
    expect(prompt).toContain('type: motorcycle');
    expect(prompt).toContain('Thunderhill');
    expect(prompt).toContain('Previous session:\n  (none)');
    expect(prompt).toContain('docs/knowledge-base/tires/pressure-basics.md');
    expect(prompt).toContain(DISCLAIMER_NOTE);
    expect(prompt).toContain(ONE_CHANGE_NOTE);
    expect(prompt).toContain('Ambient temperature: 24 C');
  });

  it('renders a previous session block when provided', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: session({ id: 'prev', date: '2026-03-01', notes: 'Good balance.' }),
      vehicle: vehicle(),
      question: 'Why did it get worse?',
      retrieved,
    });
    expect(prompt).toContain('Previous session:');
    expect(prompt).toContain('Good balance.');
    expect(prompt).not.toContain('Previous session:\n  (none)');
  });

  it('indicates when no knowledge matched', () => {
    const prompt = buildUserPrompt({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Give me a setup that wins championships.',
      retrieved: [],
    });
    expect(prompt).toContain('(none matched the query)');
  });
});

describe('buildMessages', () => {
  it('prefixes the system prompt', () => {
    const messages = buildMessages({
      session: session(),
      previousSession: null,
      vehicle: vehicle(),
      question: 'Front pushing mid-corner after +1 psi.',
      retrieved: [],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(SYSTEM_PROMPT);
    expect(messages[1].role).toBe('user');
  });
});
