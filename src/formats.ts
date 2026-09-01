import type { Segment } from "./youtube.ts";

export const FORMATS = ["json", "plain", "timestamps", "paragraphs", "srt", "vtt"] as const;

export type Format = typeof FORMATS[number];

export function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

/** Gap in seconds between segments that starts a new paragraph. */
const PARAGRAPH_GAP_SECONDS = 2.5;

function pad(value: number, size = 2): string {
  return String(Math.floor(value)).padStart(size, "0");
}

function clock(seconds: number): { h: number; m: number; s: number; ms: number } {
  const safe = Math.max(0, seconds);
  return {
    h: Math.floor(safe / 3600),
    m: Math.floor((safe % 3600) / 60),
    s: Math.floor(safe % 60),
    ms: Math.round((safe % 1) * 1000),
  };
}

export function formatMarker(seconds: number): string {
  const { h, m, s } = clock(seconds);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatSrtTime(seconds: number): string {
  const { h, m, s, ms } = clock(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function formatVttTime(seconds: number): string {
  const { h, m, s, ms } = clock(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function toPlain(segments: Segment[]): string {
  return segments.map((segment) => segment.text).join(" ");
}

export function toTimestamps(segments: Segment[]): string {
  return segments
    .map((segment) => `[${formatMarker(segment.start)}] ${segment.text}`)
    .join("\n");
}

export function toParagraphs(segments: Segment[]): string {
  const paragraphs: string[][] = [];
  let current: string[] = [];

  segments.forEach((segment, index) => {
    current.push(segment.text);
    const next = segments[index + 1];
    if (!next) return;
    const gap = next.start - (segment.start + segment.duration);
    if (gap >= PARAGRAPH_GAP_SECONDS) {
      paragraphs.push(current);
      current = [];
    }
  });

  if (current.length > 0) paragraphs.push(current);

  return paragraphs.map((paragraph) => paragraph.join(" ")).join("\n\n");
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(segment.start + segment.duration);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
}

export function toVtt(segments: Segment[]): string {
  const cues = segments
    .map((segment) => {
      const start = formatVttTime(segment.start);
      const end = formatVttTime(segment.start + segment.duration);
      return `${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}

export function render(format: Format, segments: Segment[]): string {
  switch (format) {
    case "plain":
      return toPlain(segments);
    case "timestamps":
      return toTimestamps(segments);
    case "paragraphs":
      return toParagraphs(segments);
    case "srt":
      return toSrt(segments);
    case "vtt":
      return toVtt(segments);
    case "json":
      return JSON.stringify(segments);
  }
}

export function wordCount(segments: Segment[]): number {
  return segments.reduce((total, segment) => {
    const words = segment.text.split(/\s+/).filter(Boolean);
    return total + words.length;
  }, 0);
}
