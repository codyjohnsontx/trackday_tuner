import { describe, expect, it } from 'vitest';
import { readBoundedJson } from '@/lib/http/bounded-json';

describe('readBoundedJson', () => {
  it('parses a body within the byte limit', async () => {
    const result = await readBoundedJson(new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }), 100);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('rejects malformed JSON', async () => {
    const result = await readBoundedJson(new Request('https://example.test', {
      method: 'POST',
      body: '{broken',
    }), 100);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects an oversized streamed body without relying on Content-Length', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });
    request.headers.delete('content-length');
    const result = await readBoundedJson(request, 20);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });
});
