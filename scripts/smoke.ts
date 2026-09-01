/**
 * End-to-end smoke test against a running deployment.
 *
 *   deno task smoke                              # http://localhost:8000
 *   deno task smoke https://your.deno.dev        # deployed instance
 *   API_KEY=secret deno task smoke <url>         # private deployment
 *
 * Unlike `deno task test`, this hits the real YouTube endpoints, so a failure
 * here means either the deployment is down or YouTube changed something.
 */
const baseUrl = (Deno.args[0] ?? "http://localhost:8000").replace(/\/+$/, "");
const apiKey = Deno.env.get("API_KEY") ?? "";
const headers: Record<string, string> = apiKey ? { "X-API-Key": apiKey } : {};

/** "Me at the zoo" — 19s, manual English captions, stable since 2005. */
const VIDEO = "jNQXAC9IVRw";

let failures = 0;

async function check(name: string, run: () => Promise<string>): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    const ms = Math.round(performance.now() - started);
    console.log(`  ok   ${name} (${ms}ms) ${detail}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

async function get(path: string): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return response;
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

console.log(`Smoke testing ${baseUrl}\n`);

await check("health responds ok", async () => {
  const response = await get("/api/health");
  expect(response.ok, `status ${response.status}`);
  const body = await response.json();
  expect(body.status === "ok", `unexpected body ${JSON.stringify(body)}`);
  return `version ${body.version}, auth_required=${body.auth_required}`;
});

await check("landing page renders", async () => {
  const response = await get("/");
  expect(response.ok, `status ${response.status}`);
  const html = await response.text();
  expect(html.includes("api/transcript"), "docs page missing endpoint reference");
  return `${html.length} bytes of HTML`;
});

await check("formats are listed", async () => {
  const body = await (await get("/api/formats")).json();
  expect(Array.isArray(body.formats), "formats is not an array");
  return body.formats.join(", ");
});

await check("plain transcript for a known video", async () => {
  const response = await get(`/api/transcript?url=${VIDEO}&format=plain`);
  if (!response.ok) throw new Error(`status ${response.status}: ${await response.text()}`);
  const body = await response.json();
  expect(body.success === true, "success flag not set");
  expect(
    typeof body.transcript === "string" && body.transcript.length > 50,
    "transcript too short",
  );
  expect(body.stats.segment_count > 0, "no segments returned");
  return `"${body.video.title}" — ${body.stats.word_count} words`;
});

await check("json format returns timed segments", async () => {
  const body = await (await get(`/api/transcript?url=${VIDEO}&format=json`)).json();
  const segments = body.transcript;
  expect(Array.isArray(segments) && segments.length > 0, "segments missing");
  const first = segments[0];
  expect(typeof first.text === "string", "segment.text missing");
  expect(typeof first.start === "number", "segment.start missing");
  return `${segments.length} segments, first at ${first.start}s`;
});

await check("srt download is well formed", async () => {
  const response = await get(`/api/transcript?url=${VIDEO}&format=srt&raw=true`);
  expect(response.ok, `status ${response.status}`);
  const srt = await response.text();
  expect(/^1\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /.test(srt), "first cue is malformed");
  return `${srt.split("\n\n").length} cues`;
});

await check("language list is available", async () => {
  const body = await (await get(`/api/languages?url=${VIDEO}`)).json();
  expect(body.available_languages.length > 0, "no caption tracks reported");
  return body.available_languages.map((track: { language_code: string }) => track.language_code)
    .join(", ");
});

await check("caching kicks in on the second call", async () => {
  await get(`/api/transcript?url=${VIDEO}&format=plain`);
  const body = await (await get(`/api/transcript?url=${VIDEO}&format=plain`)).json();
  expect(body.cached === true, "second identical request was not cached");
  return "cached=true";
});

await check("bad video id is rejected with 400", async () => {
  const response = await get("/api/transcript?url=https://example.com/nope");
  expect(response.status === 400, `expected 400, got ${response.status}`);
  const body = await response.json();
  expect(body.error.code === "invalid_video_id", `unexpected code ${body.error.code}`);
  return "invalid_video_id";
});

await check("missing language returns alternatives", async () => {
  const response = await get(`/api/transcript?url=${VIDEO}&lang=zu`);
  expect(response.status === 404, `expected 404, got ${response.status}`);
  const body = await response.json();
  expect(body.error.available_languages.length > 0, "alternatives not listed");
  return "language_unavailable + alternatives";
});

console.log(
  failures === 0 ? "\nAll smoke checks passed." : `\n${failures} smoke check(s) failed.`,
);
Deno.exit(failures === 0 ? 0 : 1);
