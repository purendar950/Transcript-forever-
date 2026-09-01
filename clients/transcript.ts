/**
 * Tiny client for the YouTube Transcript API.
 * Works in Deno, Node 18+, Bun, browsers, and Cloudflare Workers.
 */
export type TranscriptFormat = "json" | "plain" | "timestamps" | "paragraphs" | "srt" | "vtt";

export interface Segment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptResponse {
  success: true;
  cached: boolean;
  video: { video_id: string; title: string; author: string; duration_seconds: number };
  format: TranscriptFormat;
  language: { code: string; name: string; kind: "asr" | "manual" };
  stats: { segment_count: number; word_count: number; character_count: number };
  available_languages: { language_code: string; name: string; kind: string }[];
  transcript: string | Segment[];
}

export class TranscriptApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "TranscriptApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface GetOptions {
  format?: TranscriptFormat;
  /** Priority-ordered language tags, e.g. ["hi", "en"]. */
  lang?: string[];
}

export function createTranscriptClient({ baseUrl, apiKey }: ClientOptions) {
  const origin = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = apiKey ? { "X-API-Key": apiKey } : {};

  async function request(path: string, params: Record<string, string>) {
    const url = `${origin}${path}?${new URLSearchParams(params)}`;
    const response = await fetch(url, { headers });
    const body = await response.json();
    if (!response.ok) {
      throw new TranscriptApiError(
        body?.error?.code ?? "unknown",
        body?.error?.message ?? response.statusText,
        response.status,
      );
    }
    return body;
  }

  return {
    /** Full JSON response including metadata. */
    async get(video: string, options: GetOptions = {}): Promise<TranscriptResponse> {
      return await request("/api/transcript", {
        url: video,
        format: options.format ?? "json",
        lang: (options.lang ?? ["en"]).join(","),
      });
    },

    /** Just the transcript text in the requested format. */
    async text(video: string, options: GetOptions = {}): Promise<string> {
      const result = await this.get(video, { format: options.format ?? "plain", ...options });
      return typeof result.transcript === "string"
        ? result.transcript
        : JSON.stringify(result.transcript);
    },

    /** Timed segments, useful for search or summarisation pipelines. */
    async segments(video: string, options: GetOptions = {}): Promise<Segment[]> {
      const result = await this.get(video, { ...options, format: "json" });
      return result.transcript as Segment[];
    },

    async languages(video: string) {
      return await request("/api/languages", { url: video });
    },
  };
}
