interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Small in-memory TTL cache. Each Deno Deploy isolate keeps its own copy,
 * which is enough to absorb repeated requests for the same video.
 */
export class TtlCache<T> {
  #entries = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 200) {}

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    // refresh recency for the LRU eviction below
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.#entries.size;
  }
}
