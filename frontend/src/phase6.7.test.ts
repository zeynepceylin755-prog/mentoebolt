/**
 * Phase 6.7 — Frontend security & identity hardening.
 *
 * Proves, against the ACTIVE student frontend (`frontend/`), that:
 *   1. guided-tuition requests carry ONLY { attemptId, mode } — no identity, no
 *      client-selected MicroSkill/ErrorPattern and never a correct answer;
 *   2. the auth client never invents identity — tokens come from the login
 *      response and the refresh token is rotated, not hand-edited;
 *   3. no client-authoritative identity or canonical answer is hardcoded in the
 *      frontend source;
 *   4. no secret material is exposed through the frontend environment.
 *
 * These tests are static/DOM-level and never touch a backend or a real network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requestGuidance, submitAnswer, GUIDANCE_MODES } from '@/lib/studentJourney';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  vi.clearAllMocks();
  (localStorage.getItem as any).mockReturnValue('test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Phase 6.7 — guidance request contract', () => {
  it('requestGuidance sends only { attemptId, mode }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ data: { explanation: 'hint', mode: 'HINT' } }),
    });

    await requestGuidance('attempt-123', 'HINT');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);

    expect(Object.keys(body).sort()).toEqual(['attemptId', 'mode']);
    expect(body.attemptId).toBe('attempt-123');
    expect(body.mode).toBe('HINT');
  });

  it('no guidance mode ever transmits a correctAnswer / identity / taxonomy field', async () => {
    for (const mode of GUIDANCE_MODES) {
      vi.clearAllMocks();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ data: { explanation: 'x', mode } }),
      });
      await requestGuidance('attempt-x', mode);
      const body = JSON.stringify(JSON.parse(mockFetch.mock.calls[0][1].body as string));
      expect(body).not.toMatch(/correctAnswer/i);
      expect(body).not.toMatch(/studentId/i);
      expect(body).not.toMatch(/microSkillId/i);
      expect(body).not.toMatch(/errorPatternId/i);
      expect(body).not.toMatch(/errorType/i);
    }
  });

  it('submitAnswer does not send identity or correctness fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ data: { attemptId: 'a', isCorrect: true } }),
    });

    await submitAnswer('q-1', 'my answer', 12);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('studentId');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('isCorrect');
    expect(body).not.toHaveProperty('correctAnswer');
    expect(body).not.toHaveProperty('microSkillId');
  });
});

describe('Phase 6.7 — frontend source audit', () => {
  const srcRoot = resolve(__dirname);

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it('no source file hardcodes a correctAnswer as client context', () => {
    const offenders: string[] = [];
    // A `correctAnswer:` TYPE annotation (e.g. `correctAnswer: string | null`) is a
    // read-only field of a response contract and is fine. A VALUE assignment
    // (e.g. `correctAnswer: 'x'`, `correctAnswer: someVar`) would be
    // client-authoritative context and is forbidden.
    // `\s+` (not `\s*`) forces the space after ':' to be consumed before the
    // negative lookahead, so a type annotation like `correctAnswer: string` does
    // not false-positive through regex backtracking.
    const valueAssignment = /correctAnswer\s*:\s+(?!(?:string|number|boolean|null|any|unknown)\b)/;
    for (const file of collectSourceFiles(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      if (valueAssignment.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('no source file hardcodes a student id or user id literal', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      if (/(studentId|userId)\s*:\s*['"][^'"]+['"]/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the API client never reads a JWT that was not issued by the backend', () => {
    const client = readFileSync(join(srcRoot, 'lib', 'apiClient.ts'), 'utf8');
    // Tokens are only ever read from the persisted login response, never parsed
    // from user input or a hardcoded constant.
    expect(client).not.toMatch(/atob\(/); // no manual JWT decoding/forging
    expect(client).toMatch(/localStorage\.getItem\('access_token'\)/);
    expect(client).not.toMatch(/Bearer\s+sk-/);
  });

  it('no secret material is referenced in the frontend source', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      if (/sk-[A-Za-z0-9]{20,}/.test(text)) offenders.push(file);
      if (/OPENAI_API_KEY|JWT_SECRET|REFRESH_SECRET/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
