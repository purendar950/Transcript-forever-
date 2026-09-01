import { assertEquals } from "jsr:@std/assert@1";
import { extractVideoId } from "../src/video_id.ts";

Deno.test("accepts a bare video id", () => {
  assertEquals(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(extractVideoId("  dQw4w9WgXcQ  "), "dQw4w9WgXcQ");
});

Deno.test("parses every common YouTube URL shape", () => {
  const cases = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=30",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "www.youtube.com/watch?v=dQw4w9WgXcQ",
  ];
  for (const input of cases) {
    assertEquals(extractVideoId(input), "dQw4w9WgXcQ", input);
  }
});

Deno.test("rejects junk input", () => {
  assertEquals(extractVideoId(""), null);
  assertEquals(extractVideoId(null), null);
  assertEquals(extractVideoId("https://example.com/watch?v=short"), null);
  assertEquals(extractVideoId("not a url at all"), null);
});
