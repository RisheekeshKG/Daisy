/**
 * Stale-while-revalidate cache for the panels that fetch over the network.
 *
 * The point is what the user sees on the *second* visit to a tab. Without a
 * cache, every switch back to Mail or Calendar re-renders a skeleton and waits
 * on Google again, so the app feels like it forgets everything the moment you
 * look away. With one, the last known data paints immediately and a refresh
 * happens quietly behind it — the skeleton is then only ever shown on a genuine
 * cold start, which is the one time there is honestly nothing to show.
 *
 * Two tiers: an in-memory map for the session, and localStorage so a restart
 * still opens warm.
 */

const PREFIX = "daisy_cache_v1:";
/** Skip persisting anything pathological — localStorage has a ~5MB budget for
 *  the entire app, and chat history shares it. */
const MAX_ENTRY_BYTES = 256 * 1024;

interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

const memory = new Map<string, CacheEntry<unknown>>();

function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

export function readCache<T>(key: string, maxAgeMs?: number): T | null {
  let entry = memory.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      if (raw) {
        const parsed = JSON.parse(raw) as CacheEntry<T>;
        // Tolerate anything written by an older shape rather than throwing.
        if (parsed && typeof parsed.savedAt === "number") {
          entry = parsed;
          memory.set(key, parsed);
        }
      }
    } catch {
      /* unreadable or unparseable — treat as a miss */
    }
  }

  if (!entry) return null;
  if (maxAgeMs !== undefined && Date.now() - entry.savedAt > maxAgeMs) return null;
  return entry.value;
}

/** Age of the cached value in ms, or null when there isn't one. */
export function cacheAge(key: string): number | null {
  const entry = memory.get(key);
  if (entry) return Date.now() - entry.savedAt;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<unknown>;
    return typeof parsed?.savedAt === "number" ? Date.now() - parsed.savedAt : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  const entry: CacheEntry<T> = { value, savedAt: Date.now() };
  memory.set(key, entry);

  let serialized: string;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    return; // not serializable; the in-memory copy is still useful
  }
  if (serialized.length > MAX_ENTRY_BYTES) return;

  try {
    localStorage.setItem(storageKey(key), serialized);
  } catch {
    // Out of quota. Drop the *persisted* entries only (they are all
    // disposable) and retry once. Deliberately not evictAll(): that also
    // clears the in-memory tier, including the entry just written, so a full
    // disk would silently downgrade from "forgets on restart" to "caches
    // nothing at all".
    evictPersisted();
    try {
      localStorage.setItem(storageKey(key), serialized);
    } catch {
      /* still no room — in-memory only, which is enough for this session */
    }
  }
}

/** Remove persisted cache entries, leaving the in-memory tier intact. */
function evictPersisted(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function clearCache(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** Drop every cached entry, both tiers — used on sign-out and disconnect. */
export function evictAll(): void {
  memory.clear();
  evictPersisted();
}

/** Keys used across the app, in one place so they can't drift apart. */
export const CACHE_KEYS = {
  gmailStatus: "gmail:status",
  gmailMessages: (label: string, query: string) => `gmail:messages:${label}:${query}`,
  gmailMessage: (id: string) => `gmail:message:${id}`,
  gcalStatus: "gcal:status",
  gcalEvents: "gcal:events",
} as const;
