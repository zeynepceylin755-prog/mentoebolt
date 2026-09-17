import { describe, it, expect } from 'vitest';

/**
 * Structural content-safety checks over the product source.
 *
 * These are cheap, real guards against the two failure modes that matter most in
 * this phase: (1) the UI fabricating learning data, and (2) the UI rendering
 * untrusted server/AI text as HTML.
 *
 * They read the source with Vite's `import.meta.glob` raw mode, which works in
 * both the test and build pipelines and needs no filesystem access.
 */

const sources = import.meta.glob('../components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(sources).filter(([path]) => !path.includes('.test.'));

function filesMatching(predicate: (source: string) => boolean): string[] {
  return entries.filter(([, source]) => predicate(source)).map(([path]) => path);
}

/**
 * Strip block and line comments so a rule about what the student SEES is not
 * tripped by the documentation that explains why the rule exists.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function codeFilesMatching(predicate: (source: string) => boolean): string[] {
  return entries.filter(([, source]) => predicate(code(source))).map(([path]) => path);
}

describe('content safety', () => {
  it('finds the product source files to check', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it('never renders untrusted content as HTML', () => {
    const offenders = filesMatching((source) =>
      source.includes('dangerouslySetInnerHTML') ||
      source.includes('innerHTML') ||
      source.includes('eval(')
    );
    expect(offenders).toEqual([]);
  });

  it('never hides an API key or secret in the frontend bundle', () => {
    const offenders = filesMatching((source) =>
      /(api[_-]?key|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(source)
    );
    expect(offenders).toEqual([]);
  });

  it('reads the backend URL from the environment only', () => {
    const offenders = filesMatching((source) =>
      /https?:\/\/(localhost|127\.0\.0\.1)/.test(source)
    );
    expect(offenders).toEqual([]);
  });

  it('shows no gamification vocabulary anywhere in the product', () => {
    const offenders = codeFilesMatching((source) =>
      /\b(XP|Streak|streak|Seri|Rozet|Badge of|Level up|Seviye atla)\b/.test(source)
    );
    expect(offenders).toEqual([]);
  });

  it('shows no generic AI-marketing vocabulary anywhere in the product', () => {
    const offenders = codeFilesMatching((source) =>
      /(AI-powered|AI powered|AI destekli|devrim|sihirli|magic|revolutionary)/i.test(source)
    );
    expect(offenders).toEqual([]);
  });

  it('never surfaces raw technical pipeline vocabulary to the student', () => {
    const offenders = codeFilesMatching((source) =>
      /(Running OCR|Processing AI request|API request|PrismaClient|stack trace|Ingestion state)/.test(source)
    );
    expect(offenders).toEqual([]);
  });
});
