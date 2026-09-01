import { assertEquals } from "jsr:@std/assert@1";
import { applyEnv, config } from "../src/config.ts";

Deno.test("defaults are used when env vars are absent or invalid", () => {
  applyEnv({});
  assertEquals(config.cacheTtlMs, 3_600_000);
  assertEquals(config.rateLimit, 60);
  assertEquals(config.rateWindowMs, 60_000);
  assertEquals(config.apiKey, "");

  applyEnv({ RATE_LIMIT: "not-a-number", CACHE_TTL_SECONDS: "-5" });
  assertEquals(config.rateLimit, 60);
  assertEquals(config.cacheTtlMs, 3_600_000);
});

Deno.test("env vars override the defaults", () => {
  applyEnv({
    CACHE_TTL_SECONDS: "10",
    RATE_LIMIT: "5",
    RATE_WINDOW_SECONDS: "2",
    API_KEY: "s3cret",
  });
  assertEquals(config.cacheTtlMs, 10_000);
  assertEquals(config.rateLimit, 5);
  assertEquals(config.rateWindowMs, 2_000);
  assertEquals(config.apiKey, "s3cret");

  applyEnv({});
});
