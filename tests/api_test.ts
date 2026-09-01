import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handler } from "../src/main.ts";

const PLAYER_RESPONSE = {
  playabilityStatus: { status: "OK" },
  videoDetails: {
    videoId: "dQw4w9WgXcQ",
    title: "Test Video",
    author: "Test Channel",
    lengthSeconds: "212",
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en",
          languageCode: "en",
          name: { simpleText: "English" },
          isTranslatable: true,
        },
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=hi&kind=asr",
          languageCode: "hi",
          kind: "asr",
          name: { simpleText: "Hindi (auto-generated)" },
        },
      ],
    },
  },
};

const CAPTION_BODY = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "hello world" }] },
    { tStartMs: 1500, dDurationMs: 1500, segs: [{ utf8: "second cue" }] },
  ],
});

/** Swaps global fetch for a stub that mimics InnerTube + timedtext. */
function stubFetch(options: { player?: unknown; captionStatus?: number } = {}) {
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);

    if (url.includes("/youtubei/v1/player")) {
      return Promise.resolve(
        new Response(JSON.stringify(options.player ?? PLAYER_RESPONSE), { status: 200 }),
      );
    }
    if (url.includes("/api/timedtext")) {
      return Promise.resolve(
        new Response(CAPTION_BODY, { status: options.captionStatus ?? 200 }),
      );
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function get(path: string): Promise<Response> {
  return handler(new Request(`https://api.test${path}`));
}

Deno.test("health endpoint reports ok", async () => {
  const response = await get("/api/health");
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ok");
});

Deno.test("formats endpoint lists every renderer", async () => {
  const body = await (await get("/api/formats")).json();
  assertEquals(body.formats, ["json", "plain", "timestamps", "paragraphs", "srt", "vtt"]);
});

Deno.test("root serves the landing page", async () => {
  const response = await get("/");
  assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
  assertStringIncludes(await response.text(), "YouTube Transcript API");
});

Deno.test("preflight returns CORS headers", async () => {
  const response = await handler(
    new Request("https://api.test/api/transcript", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});

Deno.test("GET transcript returns metadata and text", async () => {
  const stub = stubFetch();
  try {
    const body = await (await get("/api/transcript?url=dQw4w9WgXcQ&format=plain")).json();
    assertEquals(body.success, true);
    assertEquals(body.transcript, "hello world second cue");
    assertEquals(body.video.title, "Test Video");
    assertEquals(body.language.code, "en");
    assertEquals(body.stats.segment_count, 2);
    assert(stub.calls.some((url) => url.includes("fmt=json3")));
  } finally {
    stub.restore();
  }
});

Deno.test("POST transcript accepts a JSON body", async () => {
  const stub = stubFetch();
  try {
    const response = await handler(
      new Request("https://api.test/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://youtu.be/9bZkp7q19f0", format: "timestamps" }),
      }),
    );
    const body = await response.json();
    assertEquals(body.transcript, "[00:00] hello world\n[00:01] second cue");
  } finally {
    stub.restore();
  }
});

Deno.test("raw=true returns bare srt with a subtitle content type", async () => {
  const stub = stubFetch();
  try {
    const response = await get("/api/transcript?url=kJQP7kiw5Fk&format=srt&raw=true");
    assertStringIncludes(response.headers.get("content-type") ?? "", "application/x-subrip");
    assertStringIncludes(await response.text(), "00:00:00,000 --> 00:00:01,500");
  } finally {
    stub.restore();
  }
});

Deno.test("second identical request is served from cache", async () => {
  const stub = stubFetch();
  try {
    await get("/api/transcript?url=abcdefghij1&format=plain");
    const body = await (await get("/api/transcript?url=abcdefghij1&format=plain")).json();
    assertEquals(body.cached, true);
  } finally {
    stub.restore();
  }
});

Deno.test("languages endpoint lists caption tracks", async () => {
  const stub = stubFetch();
  try {
    const body = await (await get("/api/languages?url=zzzzzzzzzz1")).json();
    assertEquals(body.available_languages, [
      { language_code: "en", name: "English", kind: "manual", is_translatable: true },
      { language_code: "hi", name: "Hindi (auto-generated)", kind: "asr", is_translatable: false },
    ]);
  } finally {
    stub.restore();
  }
});

Deno.test("missing url is a 400", async () => {
  const response = await get("/api/transcript");
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "invalid_request");
});

Deno.test("bad video id is a 400", async () => {
  const response = await get("/api/transcript?url=https://example.com/x");
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "invalid_video_id");
});

Deno.test("unknown format is a 400 listing valid formats", async () => {
  const response = await get("/api/transcript?url=dQw4w9WgXcQ&format=pdf");
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid_format");
  assert(body.error.available_formats.includes("srt"));
});

Deno.test("requesting an absent language is a 404 with alternatives", async () => {
  const stub = stubFetch();
  try {
    const response = await get("/api/transcript?url=bbbbbbbbbb1&lang=ja");
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error.code, "language_unavailable");
    assertEquals(body.error.available_languages.length, 2);
  } finally {
    stub.restore();
  }
});

Deno.test("video without caption tracks is a 404", async () => {
  const stub = stubFetch({
    player: { playabilityStatus: { status: "OK" }, videoDetails: { videoId: "x" } },
  });
  try {
    const response = await get("/api/transcript?url=cccccccccc1");
    assertEquals(response.status, 404);
    assertEquals((await response.json()).error.code, "captions_disabled");
  } finally {
    stub.restore();
  }
});

Deno.test("unplayable video is a 404 with YouTube's reason", async () => {
  const stub = stubFetch({
    player: { playabilityStatus: { status: "ERROR", reason: "Video unavailable" } },
  });
  try {
    const response = await get("/api/transcript?url=dddddddddd1");
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error.code, "video_unavailable");
    assertEquals(body.error.message, "Video unavailable");
  } finally {
    stub.restore();
  }
});

Deno.test("caption download failure surfaces as empty transcript", async () => {
  const stub = stubFetch({ captionStatus: 404 });
  try {
    const response = await get("/api/transcript?url=eeeeeeeeee1");
    assertEquals(response.status, 404);
    assertEquals((await response.json()).error.code, "empty_transcript");
  } finally {
    stub.restore();
  }
});

Deno.test("unknown route is a 404 listing routes", async () => {
  const response = await get("/api/nope");
  assertEquals(response.status, 404);
  assert((await response.json()).error.routes.includes("/api/transcript"));
});
