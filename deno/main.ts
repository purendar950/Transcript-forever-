/**
 * Transcript Forever — Deno Deploy v2.0
 * 
 * Uses YouTube InnerTube API (Android client) — same approach as youtube-transcript npm
 * Deploy: https://deno.com/deploy
 */

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// ── Transcript Engine (InnerTube Android Client) ────────────

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CLIENT_VERSION = "20.10.38";
const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: CLIENT_VERSION,
  },
};
const INNERTUBE_UA = `com.google.android.youtube/${CLIENT_VERSION} (Linux; U; Android 14)`;
const RE_XML = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

function extractVideoId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

interface Segment { text: string; start: number; duration: number; }

async function fetchTranscript(videoId: string): Promise<{ segments: Segment[]; language: string }> {
  // Step 1: Get player data via InnerTube Android API
  const playerRes = await fetch(INNERTUBE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": INNERTUBE_UA,
    },
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, videoId }),
  });

  if (!playerRes.ok) throw new Error(`InnerTube API failed: ${playerRes.status}`);

  const playerData = await playerRes.json();

  if (playerData.playabilityStatus?.status === "ERROR") {
    throw new Error(playerData.playabilityStatus.reason || "Video unavailable");
  }

  const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error("No captions found for this video");
  }

  // Pick best track: Hindi > English > first
  let track = captionTracks.find((t: any) => t.languageCode === "hi")
    || captionTracks.find((t: any) => t.languageCode === "en")
    || captionTracks[0];

  // Step 2: Fetch transcript XML via InnerTube transcript endpoint
  const lang = track.languageCode || "en";

  // Use the InnerTube get_transcript endpoint (works from any IP)
  const transcriptParams = encodeTranscriptParams(videoId);

  const transcriptRes = await fetch("https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": INNERTUBE_UA,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
        },
      },
      params: transcriptParams,
    }),
  });

  if (transcriptRes.ok) {
    const transcriptData = await transcriptRes.json();
    const segments = parseTranscriptResponse(transcriptData);
    if (segments.length > 0) {
      return { segments, language: lang };
    }
  }

  // Fallback: download caption XML directly
  const captionUrl = track.baseUrl.replace(/\\u0026/g, "&");
  const captionRes = await fetch(captionUrl, { headers: { "User-Agent": INNERTUBE_UA } });
  
  if (!captionRes.ok) throw new Error(`Caption download failed: ${captionRes.status}`);
  
  const xml = await captionRes.text();
  if (!xml || xml.length === 0) throw new Error("Caption response is empty");
  
  const segments: Segment[] = [];
  let match;
  while ((match = RE_XML.exec(xml)) !== null) {
    const text = decodeEntities(match[3]);
    if (text) {
      segments.push({ text, start: parseFloat(match[1]), duration: parseFloat(match[2]) });
    }
  }

  if (segments.length === 0) throw new Error("Transcript is empty");
  return { segments, language: lang };
}

function encodeTranscriptParams(videoId: string): string {
  // Protobuf encoding for transcript params
  const inner = new Uint8Array([0x0a, 0x0b, ...new TextEncoder().encode(videoId)]);
  const outer = new Uint8Array([0x0a, inner.length, ...inner]);
  return btoa(String.fromCharCode(...outer));
}

function parseTranscriptResponse(data: any): Segment[] {
  const segments: Segment[] = [];
  try {
    const body = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups || [];
    for (const group of body) {
      const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
      if (cue) {
        const text = decodeEntities(cue.cue?.simpleText || "");
        const start = parseDuration(cue.startOffsetMs);
        const duration = parseDuration(cue.durationMs);
        if (text) segments.push({ text, start, duration });
      }
    }
  } catch {}
  return segments;
}

function parseDuration(ms: string | number): number {
  return (typeof ms === "string" ? parseInt(ms, 10) : ms || 0) / 1000;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "").trim();
}

// ── Formatters ──────────────────────────────────────────────

function formatPlain(d: Segment[]): string { return d.map(e => e.text).join(" "); }

function formatTimestamped(d: Segment[]): string {
  return d.map(e => {
    const t = Math.floor(e.start), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `[${h > 0 ? h + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${e.text}`;
  }).join("\n");
}

function formatParagraphs(d: Segment[]): string {
  const p: string[][] = []; let c: string[] = [];
  for (let i = 0; i < d.length; i++) {
    c.push(d[i].text);
    if (i < d.length - 1 && (d[i + 1].start - d[i].start - d[i].duration) >= 5) { p.push(c); c = []; }
  }
  if (c.length) p.push(c);
  return p.map(x => x.join(" ")).join("\n\n");
}

function formatSummary(d: Segment[]): string {
  const a = d.map(e => e.text).join(" "), w = a.split(" ");
  if (w.length <= 500) return a;
  const s = Math.ceil(w.length / 500);
  return w.filter((_, i) => i % s === 0).join(" ");
}

function formatSrt(d: Segment[]): string {
  return d.map((e, i) => {
    const f = (sec: number) => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };
    return `${i + 1}\n${f(e.start)} --> ${f(e.start + e.duration)}\n${e.text}\n`;
  }).join("\n");
}

const FORMATTERS: Record<string, (d: Segment[]) => string> = {
  plain: formatPlain, timestamps: formatTimestamped, paragraphs: formatParagraphs,
  summary: formatSummary, srt: formatSrt,
};

// ── Telegram API ────────────────────────────────────────────

async function tg(method: string, body: Record<string, any>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMsg(chatId: number, text: string, kb?: any) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) });
}

async function editMsg(chatId: number, msgId: number, text: string, kb?: any) {
  return tg("editMessageText", { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) });
}

async function answerCb(cbId: string, text: string) {
  return tg("answerCallbackQuery", { callback_query_id: cbId, text });
}

// ── Telegram Handlers ───────────────────────────────────────

async function handleMessage(message: any) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (text === "/start" || text === "/help") {
    await sendMsg(chatId,
      "🎬 <b>Transcript Forever</b>\n\nSend a YouTube link → get the transcript.\n\n" +
      "URLs: youtube.com/watch?v=ID, youtu.be/ID, shorts/ID\n" +
      "API: <code>/api/transcript?url=URL&format=plain</code>"
    );
    return;
  }

  let url: string | null = null;
  if (text.includes("youtube.com") || text.includes("youtu.be")) {
    url = text.split(/\s+/).find(w => w.includes("youtube.com") || w.includes("youtu.be")) || null;
  }
  if (!url) { await sendMsg(chatId, 'Send a YouTube URL like:\n<code>https://youtube.com/watch?v=dQw4w9WgXcQ</code>'); return; }

  const videoId = extractVideoId(url);
  if (!videoId) { await sendMsg(chatId, "❌ Invalid YouTube URL"); return; }

  const loading = await sendMsg(chatId, "⏳ Fetching transcript...");

  try {
    const result = await fetchTranscript(videoId);
    const data = result.segments;
    const wc = data.reduce((s, e) => s + e.text.split(" ").length, 0);

    const kb = { inline_keyboard: [
      [{ text: "📝 Plain Text", callback_data: `plain:${videoId}` }, { text: "⏱ Timestamps", callback_data: `timestamps:${videoId}` }],
      [{ text: "📄 Paragraphs", callback_data: `paragraphs:${videoId}` }, { text: "📊 Summary", callback_data: `summary:${videoId}` }],
      [{ text: "🎬 SRT Subtitle", callback_data: `srt:${videoId}` }],
    ]};

    await editMsg(chatId, loading.result.message_id,
      `✅ <b>Transcript found</b>\n📊 ${wc} words · ${data.length} segments\n\nChoose format:`, kb);
  } catch (err: any) {
    await editMsg(chatId, loading.result.message_id, `❌ ${err.message}`);
  }
}

async function handleCallback(callback: any) {
  const chatId = callback.message.chat.id;
  const msgId = callback.message.message_id;
  const parts = callback.data.split(":");
  const fmt = parts[0], videoId = parts.slice(1).join(":");

  await answerCb(callback.id, `Generating ${fmt}...`);

  try {
    const result = await fetchTranscript(videoId);
    const output = (FORMATTERS[fmt] || formatPlain)(result.segments);

    if (output.length > 4000) {
      const lines = output.split("\n"); const chunks: string[] = []; let cur = "";
      for (const line of lines) {
        if (cur.length + line.length + 1 > 3900) { chunks.push(cur); cur = line; }
        else cur += (cur ? "\n" : "") + line;
      }
      if (cur) chunks.push(cur);
      await editMsg(chatId, msgId, chunks[0]);
      for (let i = 1; i < chunks.length; i++) await sendMsg(chatId, chunks[i]);
    } else {
      await editMsg(chatId, msgId, output);
    }
  } catch (err: any) {
    await editMsg(chatId, msgId, `❌ Error: ${err.message}`);
  }
}

// ── Deno.serve Entry Point ──────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (path === "/api/health") {
    return new Response(JSON.stringify({ status: "ok", service: "Transcript Forever", version: "2.0.0", platform: "Deno Deploy" }), { status: 200, headers: CORS_HEADERS });
  }

  if (path === "/api/formats") {
    return new Response(JSON.stringify({ formats: Object.keys(FORMATTERS) }), { status: 200, headers: CORS_HEADERS });
  }

  if (path === "/api/transcript") {
    let videoUrl: string | null = null, format = "plain";
    if (req.method === "POST") {
      try { const b = await req.json(); videoUrl = b.url || b.video_id; format = b.format || "plain"; } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS_HEADERS });
      }
    } else {
      videoUrl = url.searchParams.get("url") || url.searchParams.get("video_id");
      format = url.searchParams.get("format") || "plain";
    }
    if (!videoUrl) return new Response(JSON.stringify({ error: "Missing url", usage: { GET: "/api/transcript?url=URL&format=plain", POST: '{"url":"URL","format":"plain"}' } }), { status: 400, headers: CORS_HEADERS });
    const videoId = extractVideoId(videoUrl);
    if (!videoId) return new Response(JSON.stringify({ error: "Invalid YouTube URL" }), { status: 400, headers: CORS_HEADERS });
    if (!FORMATTERS[format]) return new Response(JSON.stringify({ error: "Invalid format", available: Object.keys(FORMATTERS) }), { status: 400, headers: CORS_HEADERS });

    try {
      const result = await fetchTranscript(videoId);
      const data = result.segments;
      const output = FORMATTERS[format](data);
      const wc = data.reduce((s, e) => s + e.text.split(" ").length, 0);
      return new Response(JSON.stringify({ success: true, video_id: videoId, format, language: result.language, word_count: wc, segment_count: data.length, transcript: output }), { status: 200, headers: CORS_HEADERS });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: "Failed", message: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  }

  if (path === "/webhook" && req.method === "POST") {
    if (!BOT_TOKEN) return new Response("No BOT_TOKEN", { status: 500 });
    try {
      const update = await req.json();
      if (update.message?.text) await handleMessage(update.message);
      if (update.callback_query) await handleCallback(update.callback_query);
      return new Response("OK", { status: 200 });
    } catch { return new Response("Error", { status: 500 }); }
  }

  if (path === "/") {
    return new Response(`<!DOCTYPE html><html><head><title>Transcript Forever</title>
<style>body{font-family:-apple-system,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0d1117;color:#c9d1d9}h1{color:#58a6ff}code{background:#161b22;padding:2px 6px;border-radius:4px;color:#f0883e}pre{background:#161b22;padding:16px;border-radius:8px}.ep{background:#161b22;padding:16px;border-radius:8px;margin:12px 0;border-left:3px solid #58a6ff}.m{color:#3fb950;font-weight:bold}a{color:#58a6ff}</style></head><body>
<h1>🎬 Transcript Forever</h1><p>YouTube Transcript API + Telegram Bot — runs on Deno Deploy</p>
<div class="ep"><p><span class="m">GET</span> <code>/api/transcript?url=URL&format=plain</code></p></div>
<div class="ep"><p><span class="m">POST</span> <code>/api/transcript</code></p><pre>{"url":"URL","format":"timestamps"}</pre></div>
<p>Formats: plain, timestamps, paragraphs, summary, srt</p>
<p><a href="/api/health">Health</a> · <a href="/api/formats">Formats</a></p>
</body></html>`, { headers: { "Content-Type": "text/html" } });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS_HEADERS });
});
