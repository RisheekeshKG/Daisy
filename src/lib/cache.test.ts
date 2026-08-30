import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_KEYS, cacheAge, clearCache, evictAll, readCache, writeCache } from "./cache";

beforeEach(() => {
  localStorage.clear();
  evictAll();
  vi.useRealTimers();
});

describe("read/write", () => {
  it("round-trips a value", () => {
    writeCache("k", { a: 1, b: "two" });
    expect(readCache<{ a: number; b: string }>("k")).toEqual({ a: 1, b: "two" });
  });

  it("returns null for a key that was never written", () => {
    expect(readCache("missing")).toBeNull();
  });

  it("survives a page reload (persisted, not just in memory)", () => {
    writeCache("k", [1, 2, 3]);
    evictAllMemoryOnly();
    expect(readCache<number[]>("k")).toEqual([1, 2, 3]);
  });

  it("clearCache drops a single key without touching others", () => {
    writeCache("a", 1);
    writeCache("b", 2);
    clearCache("a");
    expect(readCache("a")).toBeNull();
    expect(readCache("b")).toBe(2);
  });

  it("evictAll drops everything it owns", () => {
    localStorage.setItem("unrelated_key", "keep me");
    writeCache("a", 1);
    writeCache("b", 2);
    evictAll();
    expect(readCache("a")).toBeNull();
    expect(readCache("b")).toBeNull();
    // Cache eviction must not be a general localStorage wipe — chat history,
    // the user's name and preferences all live in the same store.
    expect(localStorage.getItem("unrelated_key")).toBe("keep me");
  });
});

describe("staleness", () => {
  it("honours maxAge", () => {
    vi.useFakeTimers();
    writeCache("k", "value");
    vi.advanceTimersByTime(5_000);
    expect(readCache("k", 10_000)).toBe("value");
    vi.advanceTimersByTime(10_000);
    expect(readCache("k", 10_000)).toBeNull();
    // Still retrievable when no max age is demanded — stale beats blank.
    expect(readCache("k")).toBe("value");
  });

  it("reports the age of a cached value", () => {
    vi.useFakeTimers();
    writeCache("k", 1);
    vi.advanceTimersByTime(3_000);
    expect(cacheAge("k")).toBeGreaterThanOrEqual(3_000);
    expect(cacheAge("never-written")).toBeNull();
  });
});

describe("resilience", () => {
  it("treats corrupt stored JSON as a miss rather than throwing", () => {
    localStorage.setItem("daisy_cache_v1:k", "{not json");
    expect(() => readCache("k")).not.toThrow();
    expect(readCache("k")).toBeNull();
  });

  it("keeps working in memory when localStorage rejects the write", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };
    try {
      expect(() => writeCache("k", "value")).not.toThrow();
      // The in-memory tier still serves it, so a full disk degrades to
      // "forgets on restart", not "crashes".
      expect(readCache("k")).toBe("value");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("skips persisting oversized entries but still caches in memory", () => {
    const huge = { blob: "x".repeat(300 * 1024) };
    writeCache("big", huge);
    expect(readCache<typeof huge>("big")).toEqual(huge);
    expect(localStorage.getItem("daisy_cache_v1:big")).toBeNull();
  });

  it("does not choke on a value that cannot be serialized", () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(() => writeCache("cyclic", cyclic)).not.toThrow();
  });
});

describe("CACHE_KEYS", () => {
  it("separates message lists by label and query", () => {
    expect(CACHE_KEYS.gmailMessages("INBOX", "")).not.toBe(
      CACHE_KEYS.gmailMessages("INBOX", "from:me")
    );
    expect(CACHE_KEYS.gmailMessages("SENT", "")).not.toBe(CACHE_KEYS.gmailMessages("INBOX", ""));
  });
});

/** Simulate a reload: forget the in-memory tier, keep localStorage. */
function evictAllMemoryOnly() {
  const saved: Record<string, string> = {};
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("daisy_cache_v1:")) saved[k] = localStorage.getItem(k)!;
  }
  evictAll();
  for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
}
