import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFiles } from '@/scripts/lib/env.mjs';

/**
 * `loadEnvFiles` (`scripts/lib/env.mjs`) is how `rag:eval`, `rag:index` and the
 * beta scripts find their keys. A blank line such as `OPENAI_API_KEY=` in
 * `.env.local` once set the variable to an empty string, so the real value in
 * `.env` was never read and the script reported the key as missing. Each case
 * points the loader at a directory of its own, so the repository's real
 * settings files are never read.
 */
describe('loadEnvFiles', () => {
  const NAME = 'TT_LOAD_ENV_FILES_TEST';
  let settingsDir: string;

  beforeEach(() => {
    settingsDir = mkdtempSync(path.join(os.tmpdir(), 'load-env-files-'));
    delete process.env[NAME];
  });

  afterEach(() => {
    rmSync(settingsDir, { recursive: true, force: true });
    delete process.env[NAME];
  });

  function write(filename: string, contents: string) {
    writeFileSync(path.join(settingsDir, filename), contents);
  }

  it('lets .env supply a value that .env.local leaves blank', () => {
    write('.env.local', `${NAME}=\n`);
    write('.env', `${NAME}=from-dotenv\n`);

    loadEnvFiles(settingsDir);

    expect(process.env[NAME]).toBe('from-dotenv');
  });

  it('treats quoted and whitespace-only values as blank too', () => {
    write('.env.local', `${NAME}=""\n`);
    write('.env', `${NAME}=from-dotenv\n`);
    loadEnvFiles(settingsDir);
    expect(process.env[NAME]).toBe('from-dotenv');

    delete process.env[NAME];
    write('.env.local', `${NAME}=   \n`);
    loadEnvFiles(settingsDir);
    expect(process.env[NAME]).toBe('from-dotenv');
  });

  it('leaves the variable unset when no settings file has a value', () => {
    write('.env.local', `${NAME}=\n`);
    write('.env', `${NAME}=''\n`);

    loadEnvFiles(settingsDir);

    expect(process.env[NAME]).toBeUndefined();
  });

  it('still prefers .env.local over .env when both have a value', () => {
    write('.env.local', `${NAME}=from-dotenv-local\n`);
    write('.env', `${NAME}=from-dotenv\n`);

    loadEnvFiles(settingsDir);

    expect(process.env[NAME]).toBe('from-dotenv-local');
  });

  it('keeps a value set in the shell over both settings files', () => {
    process.env[NAME] = 'from-shell';
    write('.env.local', `${NAME}=from-dotenv-local\n`);
    write('.env', `${NAME}=from-dotenv\n`);

    loadEnvFiles(settingsDir);

    expect(process.env[NAME]).toBe('from-shell');
  });
});
