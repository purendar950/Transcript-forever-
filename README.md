# Transcript Forever

A free, always-on HTTP API that returns the transcript of any public YouTube video that has
captions. No API key, no YouTube quota, no scraping keys.

Runs on **Deno Deploy's free tier** (also deployable to Cloudflare Workers as a backup host from the
same source file).

- Formats: `json`, `plain`, `timestamps`, `paragraphs`, `srt`, `vtt`
- Language selection with fallbacks (`lang=hi,en`)
- In-memory caching, per-IP rate limiting, optional API key
- CORS enabled, so browser apps can call it directly

## Quick start (local)

```bash
deno task dev          # http://localhost:8000
deno task test         # 37 tests
deno task check        # type check + fmt + lint
```

```bash
curl "http://localhost:8000/api/transcript?url=jNQXAC9IVRw&format=plain"
```

## Deploy free, forever

### Deno Deploy (recommended)

Free tier: 1M requests/month, 100 GiB outbound, no cold-start billing, no card.

**Option A — GitHub (auto-deploys on push)**

1. Push to GitHub (`purendar950/Transcript-forever-`).
2. Go to [dash.deno.com](https://dash.deno.com) → **New Project** → link the repo.
3. Set entrypoint to `src/main.ts`, then **Deploy**.

**Option B — CLI**

```bash
deno install -Arf jsr:@deno/deployctl
deployctl deploy --project=transcript-forever --prod --entrypoint=src/main.ts
```

Your API is then live at `https://transcript-forever.deno.dev`.

### Cloudflare Workers (optional backup)

```bash
npx wrangler@3 deploy      # uses wrangler.toml, same src/main.ts
```

## Endpoints

| Method     | Path              | Purpose                             |
| ---------- | ----------------- | ----------------------------------- |
| GET / POST | `/api/transcript` | Transcript in any supported format  |
| GET        | `/api/languages`  | Caption tracks available on a video |
| GET        | `/api/formats`    | Supported format names              |
| GET        | `/api/health`     | Health probe + cache size           |
| GET        | `/`               | Docs page with a live tester        |

### Parameters

| Name     | Default  | Notes                                                                                          |
| -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `url`    | required | Video URL or bare 11-char id. Aliases: `video`, `video_id`, `v`                                |
| `format` | `json`   | One of the six formats above                                                                   |
| `lang`   | `en`     | Comma-separated priority list, e.g. `hi,en`. Manual captions are preferred over auto-generated |
| `raw`    | `false`  | `true` returns the bare body (handy for `.srt` / `.vtt` downloads)                             |

### Response

```json
{
  "success": true,
  "cached": false,
  "video": {
    "video_id": "jNQXAC9IVRw",
    "title": "Me at the zoo",
    "author": "jawed",
    "duration_seconds": 19
  },
  "format": "plain",
  "language": { "code": "en", "name": "English", "kind": "manual" },
  "stats": { "segment_count": 6, "word_count": 39, "character_count": 217 },
  "available_languages": [
    { "language_code": "en", "name": "English", "kind": "manual", "is_translatable": true }
  ],
  "transcript": "All right, so here we are, in front of the elephants..."
}
```

With `format=json`, `transcript` is an array of `{ text, start, duration }` segments (seconds).

### Errors

Every failure returns `{ "success": false, "error": { "code", "message" } }`.

| Code                   | Status | Meaning                                   |
| ---------------------- | ------ | ----------------------------------------- |
| `invalid_request`      | 400    | Missing `url` or malformed JSON body      |
| `invalid_video_id`     | 400    | Could not parse a video id                |
| `invalid_format`       | 400    | Unknown `format`                          |
| `video_unavailable`    | 404    | Private, deleted, or region-blocked       |
| `captions_disabled`    | 404    | Video has no caption tracks               |
| `language_unavailable` | 404    | No track for `lang` (lists alternatives)  |
| `empty_transcript`     | 404    | Caption track returned no cues            |
| `rate_limited`         | 429    | Per-IP limit hit, or YouTube throttled us |
| `upstream_error`       | 502    | YouTube request failed or timed out       |

## Use it from your projects

Ready-made clients live in `clients/`.

**TypeScript / JavaScript**

```ts
import { createTranscriptClient } from "./clients/transcript.ts";

const yt = createTranscriptClient({ baseUrl: "https://transcript-forever.deno.dev" });

const text = await yt.text("https://youtu.be/jNQXAC9IVRw");
const segments = await yt.segments("jNQXAC9IVRw", { lang: ["hi", "en"] });
```

Or plain `fetch`, no dependency:

```js
const res = await fetch(`${API}/api/transcript?url=${id}&format=plain`);
const { transcript } = await res.json();
```

**Python**

```python
from clients.transcript import TranscriptClient

yt = TranscriptClient("https://transcript-forever.deno.dev")
print(yt.text("https://youtu.be/jNQXAC9IVRw"))
```

**Download subtitles**

```bash
curl "$API/api/transcript?url=$ID&format=srt&raw=true" -o captions.srt
```

## Configuration

All optional, set as env vars / Deno Deploy project variables:

| Variable              | Default | Purpose                           |
| --------------------- | ------- | --------------------------------- |
| `CACHE_TTL_SECONDS`   | `3600`  | Transcript cache lifetime         |
| `RATE_LIMIT`          | `60`    | Requests per IP per window        |
| `RATE_WINDOW_SECONDS` | `60`    | Rate-limit window length          |
| `API_KEY`             | unset   | If set, requests need `X-API-Key` |

The API is **public by default** — anyone with the URL can call it. Set `API_KEY` if you want it
private; clients then send `X-API-Key: <key>` (or `Authorization: Bearer <key>`).

Rate limiting and caching are per-isolate and in-memory, which is enough to protect a personal
deployment but not a strict global quota.

## How it works

`src/youtube.ts` calls YouTube's internal InnerTube `/player` endpoint using mobile client profiles
(Android → iOS → Android VR) that still return caption track URLs without signature deciphering. The
chosen track is downloaded as `json3`, falling back to `srv3` XML, then parsed into timed segments
and rendered by `src/formats.ts`.

Only publicly available caption data is read; no login, cookies, or media downloads are involved.
YouTube can change these internal endpoints at any time — if transcripts start failing, the client
profiles in `src/youtube.ts` are the place to update.

## Project layout

```
src/
  main.ts       HTTP router, auth, rate limit, cache wiring
  youtube.ts    InnerTube client + caption parsing
  formats.ts    plain / timestamps / paragraphs / srt / vtt / json renderers
  video_id.ts   URL and id parsing
  cache.ts      TTL + LRU memory cache
  rate_limit.ts fixed-window per-IP limiter
  http.ts       JSON/text responses, CORS, client IP
  config.ts     env-driven settings
  landing.ts    self-documenting HTML page
clients/        ready-to-use TS and Python clients
tests/          unit + route tests (network stubbed)
```
