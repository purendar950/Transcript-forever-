/**
 * Configuration read from the environment. The `Deno` guard keeps this module
 * usable on other runtimes (Cloudflare Workers, Node, Bun), where values are
 * supplied through `applyEnv` instead.
 */
export const VERSION = "1.0.0";

export interface Config {
  /** How long a fetched transcript stays in the isolate's memory cache. */
  cacheTtlMs: number;
  /** Max requests per client IP per window. */
  rateLimit: number;
  rateWindowMs: number;
  /** Optional shared secret. Empty string means the API is public. */
  apiKey: string;
}

type EnvSource = Record<string, string | undefined>;

function ambientEnv(): EnvSource {
  try {
    if (typeof Deno !== "undefined" && Deno.env) return Deno.env.toObject();
  } catch {
    // env access not granted; fall through to the defaults
  }
  return {};
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function build(env: EnvSource): Config {
  return {
    cacheTtlMs: positiveNumber(env.CACHE_TTL_SECONDS, 3600) * 1000,
    rateLimit: positiveNumber(env.RATE_LIMIT, 60),
    rateWindowMs: positiveNumber(env.RATE_WINDOW_SECONDS, 60) * 1000,
    apiKey: env.API_KEY ?? "",
  };
}

export const config: Config = build(ambientEnv());

/** Applies runtime-provided env vars (Cloudflare Workers passes them per request). */
export function applyEnv(env: EnvSource): void {
  Object.assign(config, build(env));
}
