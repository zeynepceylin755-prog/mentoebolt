import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  cachedRequest,
  clearCache,
  invalidate,
  invalidateLearningEvidence,
  useCachedResource,
} from './requestCache';
import { ApiError } from './apiClient';

describe('requestCache', () => {
  beforeEach(() => {
    clearCache();
    vi.clearAllMocks();
  });

  it('serves a repeated key from cache instead of refetching', async () => {
    const loader = vi.fn().mockResolvedValue([1, 2, 3]);

    const first = await cachedRequest('k', loader);
    const second = await cachedRequest('k', loader);

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent callers for the same key', async () => {
    let resolveIt: ((v: string) => void) | undefined;
    const loader = vi.fn(
      () => new Promise<string>((resolve) => { resolveIt = resolve; })
    );

    const a = cachedRequest('k', loader);
    const b = cachedRequest('k', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    resolveIt?.('value');

    await expect(a).resolves.toBe('value');
    await expect(b).resolves.toBe('value');
  });

  it('does not share a response between different keys', async () => {
    const loader = vi.fn().mockResolvedValue('x');
    await cachedRequest('k1', loader);
    await cachedRequest('k2', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('drops every key matching an invalidated prefix', async () => {
    const loader = vi.fn().mockResolvedValue('v');
    await cachedRequest('analytics/me/skills', loader);
    await cachedRequest('recommendations/next', loader);

    invalidate('analytics/');

    await cachedRequest('analytics/me/skills', loader);
    await cachedRequest('recommendations/next', loader);

    // Only the invalidated key refetched.
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('invalidates exactly the evidence-derived keys after an attempt', async () => {
    const loader = vi.fn().mockResolvedValue('v');
    await cachedRequest('analytics/me/skills', loader);
    await cachedRequest('recommendations/next', loader);
    await cachedRequest('question-attempts', loader);
    await cachedRequest('unrelated/key', loader);

    invalidateLearningEvidence();

    await cachedRequest('analytics/me/skills', loader);
    await cachedRequest('recommendations/next', loader);
    await cachedRequest('question-attempts', loader);
    await cachedRequest('unrelated/key', loader);

    // 4 initial fetches + 3 evidence keys refetched = 7. The unrelated key
    // stayed cached and did not refetch.
    expect(loader).toHaveBeenCalledTimes(7);
    expect(loader.mock.calls.filter((c) => c[0] === undefined).length).toBe(7);
  });

  it('re-fetches after the TTL expires', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue('v');

    await cachedRequest('k', loader, 50);
    vi.advanceTimersByTime(100);
    await cachedRequest('k', loader, 50);

    expect(loader).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not cache a rejected request', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('boom', 500))
      .mockResolvedValueOnce('recovered');

    await expect(cachedRequest('k', loader)).rejects.toThrow('boom');
    await expect(cachedRequest('k', loader)).resolves.toBe('recovered');
  });

  it('clearCache empties every key', async () => {
    const loader = vi.fn().mockResolvedValue('v');
    await cachedRequest('k', loader);
    clearCache();
    await cachedRequest('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('useCachedResource', () => {
  beforeEach(() => {
    clearCache();
    vi.clearAllMocks();
  });

  it('exposes loading, then the loaded value', async () => {
    const loader = vi.fn().mockResolvedValue({ skills: [] });

    const { result } = renderHook(() =>
      useCachedResource('hook/key', loader, 'Yüklenemedi.')
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ skills: [] });
    expect(result.current.error).toBeNull();
  });

  it('reports an ApiError message as-is for the student', async () => {
    const loader = vi.fn().mockRejectedValue(new ApiError('Sunucu hatası', 500));

    const { result } = renderHook(() =>
      useCachedResource('hook/err', loader, 'Genel hata.')
    );

    await waitFor(() => expect(result.current.error).toBe('Sunucu hatası'));
  });

  it('falls back to the caller message for a non-API failure', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('internal detail'));

    const { result } = renderHook(() =>
      useCachedResource('hook/err2', loader, 'Bugün planı yüklenemedi.')
    );

    await waitFor(() => expect(result.current.error).toBe('Bugün planı yüklenemedi.'));
    // An internal error string is never shown to the student.
    expect(result.current.error).not.toContain('internal detail');
  });

  it('refresh bypasses the cache and refetches', async () => {
    const loader = vi.fn().mockResolvedValue('first');

    const { result } = renderHook(() =>
      useCachedResource('hook/refresh', loader, 'Hata.')
    );
    await waitFor(() => expect(result.current.data).toBe('first'));
    expect(loader).toHaveBeenCalledTimes(1);

    loader.mockResolvedValue('second');
    await act(async () => {
      await result.current.refresh();
    });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('second');
  });

  it('stays idle when no key is given (an optional resource)', async () => {
    const loader = vi.fn().mockResolvedValue('x');

    const { result } = renderHook(() =>
      useCachedResource(null, loader, 'Hata.')
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(loader).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });
});
