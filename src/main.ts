import { extractVideoId } from "./video_id.ts";
import { fetchTranscript, listCaptionTracks, type TranscriptResult } from "./youtube.ts";
import { type Format, FORMATS, isFormat, render, wordCount } from "./formats.ts";
import { TranscriptError } from "./errors.ts";
import { TtlCache } from "./cache.ts";
import { RateLimiter } from "./rate_limit.ts";
import { clientIp, CORS_HEADERS, json, text } from "./http.ts";
import { LANDING_PAGE } from "./landing.ts";
import { applyEnv, config, VERSION } from "./config.ts";

interface ConnInfo {
  remoteAddr?: { hostname?: string };
}

const cache = new TtlCache<TranscriptResult>(config.cacheTtlMs);
const limiter = new RateLimiter(config.rateLimit, config.rateWindowMs);

interface TranscriptParams {
  video: string | null;
  format: string;
  languages: string[];
  raw: boolean;
}

function parseLanguages(value: string | null | undefined): string[] {
  if (!value) return ["en"];
  const languages = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return languages.length > 0 ? languages : ["en"];
}

function paramsFromQuery(url: URL): TranscriptParams {
  return {
    video: url.searchParams.get("url") ?? url.searchParams.get("video") ??
      url.searchParams.get("video_id") ?? url.searchParams.get("v"),
    format: url.searchParams.get("format") ?? "json",
    languages: parseLanguages(url.searchParams.get("lang") ?? url.searchParams.get("languages")),
    raw: ["1", "true", "yes"].includes((url.searchParams.get("raw") ?? "").toLowerCase()),
  };
}

async function paramsFromBody(request: Request): Promise<TranscriptParams> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    throw new TranscriptError("invalid_request", "Body must be valid JSON");
  }

  const video = body.url ?? body.video ?? body.video_id ?? body.v;
  const languages = Array.isArray(body.lang)
    ? body.lang.map(String)
    : parseLanguages(typeof body.lang === "string" ? body.lang : undefined);

  return {
    video: typeof video === "string" ? video : null,
    format: typeof body.format === "string" ? body.format : "json",
    languages,
    raw: body.raw === true,
  };
}

const RAW_CONTENT_TYPES: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  plain: "text/plain; charset=utf-8",
  timestamps: "text/plain; charset=utf-8",
  paragraphs: "text/plain; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
};

async function handleTranscript(params: TranscriptParams): Promise<Response> {
  if (!params.video) {
    throw new TranscriptError("invalid_request", "Missing `url` parameter", {
      usage: {
        GET: "/api/transcript?url=<youtube-url>&format=plain&lang=en",
        POST: { url: "<youtube-url>", format: "plain", lang: "en" },
      },
    });
  }

  const videoId = extractVideoId(params.video);
  if (!videoId) {
    throw new TranscriptError("invalid_video_id", "Could not parse a YouTube video id");
  }

  if (!isFormat(params.format)) {
    throw new TranscriptError("invalid_format", `Unknown format \`${params.format}\``, {
      available_formats: FORMATS,
    });
  }

  const cacheKey = `${videoId}:${params.languages.join(",")}`;
  let result = cache.get(cacheKey);
  const cached = result !== undefined;
  if (!result) {
    result = await fetchTranscript(videoId, { languages: params.languages });
    cache.set(cacheKey, result);
  }

  const output = render(params.format, result.segments);

  if (params.raw) {
    return text(output, RAW_CONTENT_TYPES[params.format]);
  }

  return json({
    success: true,
    cached,
    video: result.meta,
    format: params.format,
    language: {
      code: result.language_code,
      name: result.language_name,
      kind: result.kind,
    },
    stats: {
      segment_count: result.segments.length,
      word_count: wordCount(result.segments),
      character_count: output.length,
    },
    available_languages: result.available_languages,
    transcript: params.format === "json" ? result.segments : output,
  });
}

async function handleLanguages(url: URL): Promise<Response> {
  const input = url.searchParams.get("url") ?? url.searchParams.get("video_id");
  const videoId = extractVideoId(input);
  if (!videoId) {
    throw new TranscriptError("invalid_video_id", "Could not parse a YouTube video id");
  }

  const { meta, tracks } = await listCaptionTracks(videoId);
  return json({ success: true, video: meta, available_languages: tracks });
}

function authorized(request: Request, url: URL): boolean {
  if (!config.apiKey) return true;
  const header = request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const provided = header || (url.searchParams.get("api_key") ?? "");
  return provided === config.apiKey;
}

function errorResponse(error: unknown): Response {
  if (error instanceof TranscriptError) {
    return json({
      success: false,
      error: { code: error.code, message: error.message, ...error.details },
    }, { status: error.status });
  }

  console.error("unhandled error:", error);
  return json({
    success: false,
    error: { code: "internal_error", message: "Unexpected server error" },
  }, { status: 500 });
}

export async function handler(request: Request, info?: ConnInfo): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (path === "/") {
    return text(LANDING_PAGE, "text/html; charset=utf-8");
  }

  if (path === "/api/health") {
    return json({
      status: "ok",
      version: VERSION,
      cached_videos: cache.size,
      auth_required: config.apiKey !== "",
    });
  }

  if (path === "/api/formats") {
    return json({ formats: FORMATS, default: "json" });
  }

  if (!authorized(request, url)) {
    return json({
      success: false,
      error: { code: "unauthorized", message: "Missing or invalid API key" },
    }, { status: 401 });
  }

  const ip = clientIp(request, info);
  const limit = limiter.check(ip);
  if (!limit.allowed) {
    return json({
      success: false,
      error: { code: "rate_limited", message: "Too many requests, slow down" },
    }, {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Limit": String(config.rateLimit),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  try {
    if (path === "/api/transcript") {
      if (request.method === "POST") {
        return await handleTranscript(await paramsFromBody(request));
      }
      if (request.method === "GET") {
        return await handleTranscript(paramsFromQuery(url));
      }
      throw new TranscriptError("invalid_request", "Use GET or POST");
    }

    if (path === "/api/languages" && request.method === "GET") {
      return await handleLanguages(url);
    }
  } catch (error) {
    return errorResponse(error);
  }

  return json({
    success: false,
    error: {
      code: "not_found",
      message: `No route for ${request.method} ${path}`,
      routes: ["/api/transcript", "/api/languages", "/api/formats", "/api/health"],
    },
  }, { status: 404 });
}

/**
 * Default export shape understood by both `deno serve` and Cloudflare Workers.
 * Workers hands env vars in per request, so they are applied on first call.
 */
export default {
  fetch(
    request: Request,
    envOrInfo?: Record<string, string | undefined> | ConnInfo,
    _ctx?: unknown,
  ): Promise<Response> {
    if (envOrInfo && !("remoteAddr" in envOrInfo)) {
      applyEnv(envOrInfo as Record<string, string | undefined>);
      return handler(request);
    }
    return handler(request, envOrInfo as ConnInfo | undefined);
  },
};
