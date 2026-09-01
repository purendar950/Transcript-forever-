import { TranscriptError } from "./errors.ts";

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

interface ClientProfile {
  name: string;
  userAgent: string;
  context: Record<string, unknown>;
}

/**
 * InnerTube clients that still return caption tracks without a signature
 * challenge. They are tried in order until one yields captions.
 */
const CLIENTS: ClientProfile[] = [
  {
    name: "ANDROID",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    context: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
      platform: "MOBILE",
    },
  },
  {
    name: "IOS",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
    context: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      platform: "MOBILE",
    },
  },
  {
    name: "ANDROID_VR",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L) gzip",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.62.27",
      androidSdkVersion: 32,
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
    },
  },
];

export interface Segment {
  text: string;
  start: number;
  duration: number;
}

export interface CaptionTrack {
  language_code: string;
  name: string;
  kind: "asr" | "manual";
  is_translatable: boolean;
}

export interface VideoMeta {
  video_id: string;
  title: string;
  author: string;
  duration_seconds: number;
}

export interface TranscriptResult {
  meta: VideoMeta;
  language_code: string;
  language_name: string;
  kind: "asr" | "manual";
  segments: Segment[];
  available_languages: CaptionTrack[];
}

interface RawCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawCaptionTrack[] };
  };
}

const FETCH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TranscriptError("upstream_error", "YouTube request timed out");
    }
    throw new TranscriptError("upstream_error", "YouTube request failed");
  } finally {
    clearTimeout(timer);
  }
}

async function callPlayer(videoId: string, client: ClientProfile): Promise<PlayerResponse> {
  const response = await fetchWithTimeout(INNERTUBE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: { client: { ...client.context, hl: "en", gl: "US" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  if (response.status === 429) {
    throw new TranscriptError("rate_limited", "YouTube is rate limiting this server");
  }
  if (!response.ok) {
    throw new TranscriptError("upstream_error", `InnerTube responded with ${response.status}`);
  }

  return await response.json() as PlayerResponse;
}

function trackName(track: RawCaptionTrack): string {
  return track.name?.simpleText ?? track.name?.runs?.map((run) => run.text).join("") ??
    track.languageCode;
}

function describeTracks(tracks: RawCaptionTrack[]): CaptionTrack[] {
  return tracks.map((track) => ({
    language_code: track.languageCode,
    name: trackName(track),
    kind: track.kind === "asr" ? "asr" : "manual",
    is_translatable: track.isTranslatable === true,
  }));
}

/**
 * Picks the best track for the requested languages. Manual captions win over
 * auto-generated ones, exact tags win over prefix matches (`en` vs `en-GB`).
 */
function pickTrack(tracks: RawCaptionTrack[], languages: string[]): RawCaptionTrack | null {
  for (const wanted of languages) {
    const target = wanted.toLowerCase();
    const candidates = tracks.filter((track) => {
      const code = track.languageCode.toLowerCase();
      return code === target || code.startsWith(`${target}-`) || target.startsWith(`${code}-`);
    });
    if (candidates.length === 0) continue;

    const exactManual = candidates.find(
      (track) => track.languageCode.toLowerCase() === target && track.kind !== "asr",
    );
    if (exactManual) return exactManual;

    const manual = candidates.find((track) => track.kind !== "asr");
    if (manual) return manual;

    return candidates[0];
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function normalizeText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

export function parseJson3(body: string): Segment[] {
  let parsed: { events?: Json3Event[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const segments: Segment[] = [];
  for (const event of parsed.events ?? []) {
    if (event.tStartMs === undefined || !event.segs) continue;
    const text = normalizeText(event.segs.map((seg) => seg.utf8 ?? "").join(""));
    if (!text) continue;
    segments.push({
      text,
      start: event.tStartMs / 1000,
      duration: (event.dDurationMs ?? 0) / 1000,
    });
  }
  return segments;
}

export function parseTimedTextXml(body: string): Segment[] {
  const segments: Segment[] = [];

  // srv3 / timedtext format 3: <p t="ms" d="ms">text</p> (may contain <s> children)
  const paragraphs = body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g);
  for (const paragraph of paragraphs) {
    const attributes = paragraph[1];
    const start = attributes.match(/\bt="(-?\d+)"/);
    if (!start) continue;
    const duration = attributes.match(/\bd="(-?\d+)"/);
    const text = normalizeText(paragraph[2]);
    if (!text) continue;
    segments.push({
      text,
      start: Number(start[1]) / 1000,
      duration: Number(duration?.[1] ?? 0) / 1000,
    });
  }
  if (segments.length > 0) return segments;

  // legacy format: <text start="sec" dur="sec">text</text>
  const texts = body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g);
  for (const entry of texts) {
    const attributes = entry[1];
    const start = attributes.match(/\bstart="([\d.]+)"/);
    if (!start) continue;
    const duration = attributes.match(/\bdur="([\d.]+)"/);
    const text = normalizeText(entry[2]);
    if (!text) continue;
    segments.push({
      text,
      start: Number(start[1]),
      duration: Number(duration?.[1] ?? 0),
    });
  }
  return segments;
}

export function parseCaptions(body: string): Segment[] {
  const trimmed = body.trimStart();
  const segments = trimmed.startsWith("{") ? parseJson3(trimmed) : parseTimedTextXml(trimmed);
  return fillMissingDurations(segments);
}

/** Some tracks omit durations; derive them from the next cue's start time. */
function fillMissingDurations(segments: Segment[]): Segment[] {
  return segments.map((segment, index) => {
    if (segment.duration > 0) return segment;
    const next = segments[index + 1];
    const duration = next ? Math.max(next.start - segment.start, 0.5) : 3;
    return { ...segment, duration };
  });
}

async function downloadTrack(track: RawCaptionTrack, userAgent: string): Promise<Segment[]> {
  const attempts = ["json3", "srv3"];

  for (const format of attempts) {
    const url = new URL(track.baseUrl.replace(/\\u0026/g, "&"));
    url.searchParams.set("fmt", format);

    const response = await fetchWithTimeout(url.toString(), {
      headers: { "User-Agent": userAgent, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (response.status === 429) {
      throw new TranscriptError("rate_limited", "YouTube is rate limiting this server");
    }
    if (!response.ok) continue;

    const body = await response.text();
    const segments = parseCaptions(body);
    if (segments.length > 0) return segments;
  }

  return [];
}

function toMeta(videoId: string, response: PlayerResponse): VideoMeta {
  const details = response.videoDetails;
  return {
    video_id: videoId,
    title: details?.title ?? "",
    author: details?.author ?? "",
    duration_seconds: Number(details?.lengthSeconds ?? 0),
  };
}

interface FetchOptions {
  /** Preferred language tags in priority order, e.g. `["hi", "en"]`. */
  languages?: string[];
}

export async function fetchTranscript(
  videoId: string,
  options: FetchOptions = {},
): Promise<TranscriptResult> {
  const languages = options.languages?.length ? options.languages : ["en"];
  let lastStatus: string | undefined;
  let sawPlayableVideo = false;
  let meta: VideoMeta | null = null;

  for (const client of CLIENTS) {
    const response = await callPlayer(videoId, client);
    const status = response.playabilityStatus?.status;
    lastStatus = response.playabilityStatus?.reason ?? status;

    if (status && status !== "OK") continue;
    sawPlayableVideo = true;
    meta ??= toMeta(videoId, response);

    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (tracks.length === 0) continue;

    const available = describeTracks(tracks);
    const track = pickTrack(tracks, languages);
    if (!track) {
      throw new TranscriptError(
        "language_unavailable",
        `No captions for ${languages.join(", ")}`,
        { available_languages: available },
      );
    }

    const segments = await downloadTrack(track, client.userAgent);
    if (segments.length === 0) {
      throw new TranscriptError("empty_transcript", "Caption track returned no cues", {
        available_languages: available,
      });
    }

    return {
      meta: meta ?? toMeta(videoId, response),
      language_code: track.languageCode,
      language_name: trackName(track),
      kind: track.kind === "asr" ? "asr" : "manual",
      segments,
      available_languages: available,
    };
  }

  if (sawPlayableVideo) {
    throw new TranscriptError("captions_disabled", "This video has no caption tracks");
  }

  throw new TranscriptError("video_unavailable", lastStatus ?? "Video is unavailable");
}

export async function listCaptionTracks(videoId: string): Promise<{
  meta: VideoMeta;
  tracks: CaptionTrack[];
}> {
  let lastStatus: string | undefined;

  for (const client of CLIENTS) {
    const response = await callPlayer(videoId, client);
    const status = response.playabilityStatus?.status;
    lastStatus = response.playabilityStatus?.reason ?? status;
    if (status && status !== "OK") continue;

    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return { meta: toMeta(videoId, response), tracks: describeTracks(tracks) };
  }

  throw new TranscriptError("video_unavailable", lastStatus ?? "Video is unavailable");
}
