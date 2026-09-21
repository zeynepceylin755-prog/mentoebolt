import { describe, it, expect, beforeEach } from 'vitest';

/**
 * REGRESSION — an expired access token must NOT be treated as a live session.
 *
 * Mirrors AuthContext.parseAccessToken AFTER the fix: an expired token (or one
 * with no usable exp) returns null so restoreSession falls through to the
 * existing refresh path instead of rendering a signed-in UI that sends a stale
 * bearer token.
 */

function parseAccessToken(token: string): { userId: string; email: string; role: string } | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload));
    if (typeof decoded?.userId !== 'string') return null;
    if (typeof decoded?.exp !== 'number') return null;
    if (decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      userId: decoded.userId,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      role: typeof decoded.role === 'string' ? decoded.role : 'STUDENT',
    };
  } catch {
    return null;
  }
}

function tokenWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ userId: 'u-1', email: 'a@b.c', role: 'STUDENT', exp })
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('AuthContext.parseAccessToken — expiry awareness', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts a token that is still valid', () => {
    const valid = tokenWithExp(Math.floor(Date.now() / 1000) + 600);
    expect(parseAccessToken(valid)?.userId).toBe('u-1');
  });

  it('rejects an expired token so the refresh path is taken', () => {
    const expired = tokenWithExp(Math.floor(Date.now() / 1000) - 1);
    expect(parseAccessToken(expired)).toBeNull();
  });

  it('rejects a token with no exp claim (cannot be trusted as live)', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 'u-1', role: 'STUDENT' })).toString('base64url');
    expect(parseAccessToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it('rejects a structurally invalid token', () => {
    expect(parseAccessToken('not-a-jwt')).toBeNull();
    expect(parseAccessToken('')).toBeNull();
  });

  it('rejects a token whose payload is not decodable', () => {
    expect(parseAccessToken('aaa.!!!not-base64!!!.ccc')).toBeNull();
  });
});
