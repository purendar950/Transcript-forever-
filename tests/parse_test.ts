import { assertEquals } from "jsr:@std/assert@1";
import { parseCaptions } from "../src/youtube.ts";

Deno.test("parses srv3 timedtext with entities and nested tags", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
<p t="1360" d="1680">[&#9834;]</p>
<p t="18640" d="3240">We&#39;re no strangers <s>to love</s></p>
<p t="22640" d="4320">You know the rules
and so do I &amp; you</p>
</body></timedtext>`;

  assertEquals(parseCaptions(xml), [
    { text: "[♪]", start: 1.36, duration: 1.68 },
    { text: "We're no strangers to love", start: 18.64, duration: 3.24 },
    { text: "You know the rules and so do I & you", start: 22.64, duration: 4.32 },
  ]);
});

Deno.test("parses legacy start/dur transcript xml", () => {
  const xml = `<transcript>
<text start="0.5" dur="2.0">hello there</text>
<text start="2.5" dur="1.5">general kenobi</text>
</transcript>`;

  assertEquals(parseCaptions(xml), [
    { text: "hello there", start: 0.5, duration: 2 },
    { text: "general kenobi", start: 2.5, duration: 1.5 },
  ]);
});

Deno.test("parses json3 and skips empty cues", () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "split " }, { utf8: "cue" }] },
      { tStartMs: 3000, segs: [{ utf8: "no duration" }] },
    ],
  });

  assertEquals(parseCaptions(body), [
    { text: "split cue", start: 1, duration: 2 },
    { text: "no duration", start: 3, duration: 3 },
  ]);
});

Deno.test("returns nothing for unparseable bodies", () => {
  assertEquals(parseCaptions("<html>Sorry...</html>"), []);
  assertEquals(parseCaptions("{not json"), []);
});
