import { useEffect, useState, useCallback, useRef } from 'react';
import { ApiError } from './apiClient';

/**
 * A tiny, dependency-free request cache for the student pages.
 *
 * Why this exists: "Bugün", "Soru Getir", "Tekrarlarım" and "Gelişim" all
 * read overlapping slices of the same evidence (skill progress, the next
 * recommendation, recent attempts). Without sharing, every navigation re-issued
 * the identical GET, which is both wasteful and a genuine problem in production —
 * the backend rate-limits per IP, so a student clicking through the navigation
 * could throttle themselves out of their own data.
 *
 * Design constraints, kept deliberately small:
 *  - In-memory only. No persistence, no global state library.
 *  - A short TTL, because learning data does change during a session. After an
 *    attempt is submitted the affected keys are invalidated explicitly, so the
 *    TTL is only a backstop for navigation, not a source of staleness.
 *  - In-flight de-duplication, so two pages mounting at once share one request.
 *  - `refresh()` always bypasses the cache, which is what the retry button and
 *    the post-attempt invalidation use.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** How long a cached response stays fresh (ms). */
const DEFAULT_TTL_MS = 20_000;

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Drop every cached response whose key starts with the given prefix. */
export function invalidate(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate the evidence-derived caches.
 *
 * Called after an answer is evaluated: mastery, error analysis and the next
 * recommendation all change at that moment, so every screen that reads them must
 * fetch again rather than serve a pre-attempt snapshot.
 */
export function invalidateLearningEvidence(): void {
  invalidate('analytics/me/skills');
  invalidate('recommendations/next');
  invalidate('question-attempts');
}

/** Read through the cache, de-duplicating concurrent callers for the same key. */
export async function cachedRequest<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  const promise = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Clear everything. Used by tests and on sign-out. */
export function clearCache(): void {
  cache.clear();
  inFlight.clear();
}

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Refetch, bypassing the cache. */
  refresh: () => Promise<void>;
}

/**
 * Load a cached resource with explicit loading/error state.
 *
 * `fallbackMessage` is the student-facing sentence used for any failure that is
 * not already an actionable `ApiError` message.
 */
export function useCachedResource<T>(
  key: string | null,
  loader: () => Promise<T>,
  fallbackMessage: string
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);

  // Guards against a state update from an unmounted page.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The loader is almost always an inline arrow function, so it has a new
  // identity on every render. Holding it in a ref keeps `load` stable in terms
  // of `key` alone; otherwise the effect below would re-run forever and the page
  // would never leave its loading state.
  const loaderRef = useRef(loader);
  const messageRef = useRef(fallbackMessage);
  // Assigned during render (not in an effect) so an explicit `refresh()` issued
  // immediately after a state change already sees the current loader.
  loaderRef.current = loader;
  messageRef.current = fallbackMessage;

  const load = useCallback(
    async (bypassCache: boolean) => {
      if (!key) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // A refresh genuinely bypasses the cache — it must not be served the
        // snapshot it is trying to replace.
        const value = bypassCache
          ? await loaderRef.current()
          : await cachedRequest(key, () => loaderRef.current());

        if (bypassCache) {
          // Keep the cache consistent with what was just fetched.
          cache.set(key, { value, expiresAt: Date.now() + DEFAULT_TTL_MS });
        }

        if (mounted.current) {
          setData(value);
        }
      } catch (err) {
        if (mounted.current) {
          setError(err instanceof ApiError ? err.message : messageRef.current);
        }
      } finally {
        if (mounted.current) {
          setLoading(false);
        }
      }
    },
    [key]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, loading, error, refresh };
}
