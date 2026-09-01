import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { render, wordCount } from "../src/formats.ts";
import type { Segment } from "../src/youtube.ts";

const segments: Segment[] = [
  { text: "first line", start: 0, duration: 1.5 },
  { text: "second line", start: 1.5, duration: 1.5 },
  { text: "after a pause", start: 65.25, duration: 2 },
];

Deno.test("plain joins text with spaces", () => {
  assertEquals(render("plain", segments), "first line second line after a pause");
});

Deno.test("timestamps use mm:ss and roll over to h:mm:ss", () => {
  assertEquals(
    render("timestamps", segments),
    "[00:00] first line\n[00:01] second line\n[01:05] after a pause",
  );
  const long = render("timestamps", [{ text: "late", start: 3725, duration: 1 }]);
  assertEquals(long, "[1:02:05] late");
});

Deno.test("paragraphs break on gaps of 2.5s or more", () => {
  assertEquals(render("paragraphs", segments), "first line second line\n\nafter a pause");
});

Deno.test("srt numbers cues and uses comma milliseconds", () => {
  const srt = render("srt", segments);
  assertStringIncludes(srt, "1\n00:00:00,000 --> 00:00:01,500\nfirst line");
  assertStringIncludes(srt, "3\n00:01:05,250 --> 00:01:07,250\nafter a pause");
});

Deno.test("vtt starts with the WEBVTT header and dot milliseconds", () => {
  const vtt = render("vtt", segments);
  assertStringIncludes(vtt, "WEBVTT");
  assertStringIncludes(vtt, "00:00:01.500 --> 00:00:03.000\nsecond line");
});

Deno.test("json round-trips the segments", () => {
  assertEquals(JSON.parse(render("json", segments)), segments);
});

Deno.test("word count ignores extra whitespace", () => {
  assertEquals(wordCount(segments), 7);
});
