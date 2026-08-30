import { useCallback, useEffect, useRef, useState } from "react";
import { cacheAge, readCache, writeCache } from "./cache";

export interface CachedResource<T> {
  data: T | null;
  /** True only when there is nothing cached to show — i.e. show a skeleton. */
  isLoading: boolean;
  /** True while refreshing *behind* already-visible data — show a quiet hint. */
  isRefreshing: boolean;
  error: string;
  /** How stale the visible data is, in ms (null when it came from the network). */
  ageMs: number | null;
  refresh: () => void;
  /** Update the cached value locally, e.g. after an optimistic mutation. */
  mutate: (updater: (current: T | null) => T | null) => void;
}

interface Options {
  /** Don't fetch (and don't show a skeleton) until this is true. */
  enabled?: boolean;
  /** Cached values older than this trigger a background refresh on mount. */
  maxAgeMs?: number;
}

/**
 * Read-through cache for a network resource.
 *
 * The distinction that matters for the UI is `isLoading` vs `isRefreshing`:
 * the first means we have nothing and a skeleton is honest, the second means
 * we already have something worth showing and replacing it with a skeleton
 * would be a downgrade. Conflating them is what makes an app flash grey boxes
 * every time you change tabs.
 */
export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  { enabled = true, maxAgeMs = 60_000 }: Options = {}
): CachedResource<T> {
  const [data, setData] = useState<T | null>(() => (enabled ? readCache<T>(key) : null));
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [ageMs, setAgeMs] = useState<number | null>(() => (enabled ? cacheAge(key) : null));

  // Kept in refs so the effect below doesn't re-run when the caller passes a
  // fresh closure on every render (which every inline arrow function does).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    try {
      const value = await fetcherRef.current();
      if (id !== requestId.current) return; // a newer request superseded this
      writeCache(key, value);
      setData(value);
      setAgeMs(null);
      setError("");
    } catch (err) {
      if (id !== requestId.current) return;
      // Deliberately keeps `data` in place: stale content plus an error note is
      // more useful than blanking the panel because one refresh failed.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const cached = readCache<T>(key);
    setData(cached);
    setAgeMs(cacheAge(key));
    // Fresh enough to trust as-is; skip the network entirely.
    if (cached !== null && readCache<T>(key, maxAgeMs) !== null) return;
    void load();
  }, [key, enabled, maxAgeMs, load]);

  const mutate = useCallback(
    (updater: (current: T | null) => T | null) => {
      setData((current) => {
        const next = updater(current);
        if (next !== null) writeCache(key, next);
        return next;
      });
    },
    [key]
  );

  return {
    data,
    isLoading: enabled && data === null && !error,
    isRefreshing,
    error,
    ageMs,
    refresh: load,
    mutate,
  };
}
