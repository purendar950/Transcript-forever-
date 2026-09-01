import { assertEquals } from "jsr:@std/assert@1";
import { TtlCache } from "../src/cache.ts";
import { RateLimiter } from "../src/rate_limit.ts";

Deno.test("cache returns values before the ttl expires", () => {
  const cache = new TtlCache<string>(50);
  cache.set("a", "value");
  assertEquals(cache.get("a"), "value");
  assertEquals(cache.get("missing"), undefined);
});

Deno.test("cache expires entries after the ttl", async () => {
  const cache = new TtlCache<string>(10);
  cache.set("a", "value");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assertEquals(cache.get("a"), undefined);
  assertEquals(cache.size, 0);
});

Deno.test("cache evicts the least recently used entry when full", () => {
  const cache = new TtlCache<number>(1000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assertEquals(cache.get("b"), undefined);
  assertEquals(cache.get("a"), 1);
  assertEquals(cache.get("c"), 3);
});

Deno.test("rate limiter blocks past the limit and resets per key", () => {
  const limiter = new RateLimiter(2, 1000);
  assertEquals(limiter.check("ip1").allowed, true);
  assertEquals(limiter.check("ip1").remaining, 0);
  assertEquals(limiter.check("ip1").allowed, false);
  assertEquals(limiter.check("ip2").allowed, true);
});
