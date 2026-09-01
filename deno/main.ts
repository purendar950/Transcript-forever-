/**
 * Transcript Forever — Deno Deploy Version
 * 
 * Deploy on: https://deno.com/deploy (FREE — 100k req/month, no credit card)
 * 
 * YouTube doesn't block Deno IPs, so transcript fetching works perfectly.
 */

// ── Config ──────────────────────────────────────────────────

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// ── Transcript Engine ───────────────────────────────────────

function extractVideoId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

interface TranscriptResult {
  segments: TranscriptSegment[];
  language: string;
}

async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // Fetch YouTube page
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": agent,
      "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);
  
  const html = await res.text();

  // Extract caption tracks
  let tracks: any[] | null = null;

  // Method A: Direct regex
  const capMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/);
  if (capMatch) {
    try { tracks = JSON.parse(capMatch[1]); } catch {}
  }

  // Method B: ytInitialPlayerResponse
  if (!tracks) {
    const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*var\s/);
    if (prMatch) {
      try {
        const pr = JSON.parse(prMatch[1]);
        tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      } catch {}
    }
  }

  // Method C: Alternative pattern
  if (!tracks) {
    const capMatch2 = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (capMatch2) {
      try { tracks = JSON.parse(capMatch2[1]); } catch {}
    }
  }

  if (!tracks || tracks.length === 0) {
    throw new Error("No captions found for this video. The video may not have subtitles.");
  }

  // Pick best track: Hindi > English > first
  let track = tracks.find((t: any) => t.languageCode === "hi")
    || tracks.find((t: any) => t.languageCode === "en")
    || tracks[0];

  // Download caption XML
  let captionUrl = track.baseUrl;
  if (captionUrl) {
    captionUrl = captionUrl.replace(/\\u0026/g, "&");
  }

  const captionRes = await fetch(captionUrl, {
    headers: { "User-Agent": agent },
  });

  if (!captionRes.ok) throw new Error(`Caption download failed: ${captionRes.status}`);

  const xml = await captionRes.text();

  // Parse XML
  const segments: TranscriptSegment[] = [];
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[3]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, "")
      .replace(/\n/g, " ")
      .trim();
    if (text) {
      segments.push({
        text,
        start: parseFloat(match[1]),
        duration: parseFloat(match[2]),
      });
    }
  }

  if (segments.length === 0) throw new Error("Transcript is empty");

  return { segments, language: track.languageCode || "unknown" };
}

// ── Formatters ──────────────────────────────────────────────

function formatPlain(d: TranscriptSegment[]): string {
  return d.map(e => e.text).join(" ");
}

function formatTimestamped(d: TranscriptSegment[]): string {
  return d.map(e => {
    const t = Math.floor(e.start);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `[${h > 0 ? h + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${e.text}`;
  }).join("\n");
}

function formatParagraphs(d: TranscriptSegment[]): string {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (let i = 0; i < d.length; i++) {
    cur.push(d[i].text);
    if (i < d.length - 1 && (d[i + 1].start - d[i].start - d[i].duration) >= 5) {
      paras.push(cur);
      cur = [];
    }
  }
  if (cur.length) paras.push(cur);
  return paras.map(p => p.join(" ")).join("\n\n");
}

function formatSummary(d: TranscriptSegment[]): string {
  const all = d.map(e => e.text).join(" ");
  const words = all.split(" ");
  if (words.length <= 500) return all;
  const step = Math.ceil(words.length / 500);
  return words.filter((_, i) => i % step === 0).join(" ");
}

function formatSrt(d: TranscriptSegment[]): string {
  return d.map((e, i) => {
    const f = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };
    return `${i + 1}\n${f(e.start)} --> ${f(e.start + e.duration)}\n${e.text}\n`;
  }).join("\n");
}

const FORMATTERS: Record<string, (d: TranscriptSegment[]) => string> = {
  plain: formatPlain,
  timestamps: formatTimestamped,
  paragraphs: formatParagraphs,
  summary: formatSummary,
  srt: formatSrt,
};

// ── Telegram API ────────────────────────────────────────────

async function tg(method: string, body: Record<string, any>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMsg(chatId: number, text: string, kb?: any) {
  const body: any = { chat_id: chatId, text, parse_mode: "HTML" };
  if (kb) body.reply_markup = kb;
  return tg("sendMessage", body);
}

async function editMsg(chatId: number, msgId: number, text: string, kb?: any) {
  const body: any = { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML" };
  if (kb) body.reply_markup = kb;
  return tg("editMessageText", body);
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
      "🎬 <b>Transcript Forever</b>\n\n" +
      "Send a YouTube link → get the transcript.\n\n" +
      "URLs: youtube.com/watch?v=ID, youtu.be/ID, shorts/ID\n" +
      "API: <code>/api/transcript?url=URL&format=plain</code>"
    );
    return;
  }

  // Find YouTube URL
  let url: string | null = null;
  if (text.includes("youtube.com") || text.includes("youtu.be")) {
    url = text.split(/\s+/).find(w => w.includes("youtube.com") || w.includes("youtu.be")) || null;
  }
  if (!url) {
    await sendMsg(chatId, 'Send a YouTube URL like:\n<code>https://youtube.com/watch?v=dQw4w9WgXcQ</code>');
    return;
  }

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
      const lines = output.split("\n");
      const chunks: string[] = [];
      let cur = "";
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

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // API Routes
  if (path === "/api/health") {
    return new Response(JSON.stringify({
      status: "ok", service: "Transcript Forever", version: "1.5.0", platform: "Deno Deploy",
      endpoints: { transcript: "GET/POST /api/transcript?url=URL&format=plain", health: "/api/health", formats: "/api/formats" },
    }), { status: 200, headers: CORS_HEADERS });
  }

  if (path === "/api/formats") {
    return new Response(JSON.stringify({ formats: Object.keys(FORMATTERS) }), { status: 200, headers: CORS_HEADERS });
  }

  if (path === "/api/transcript") {
    let videoUrl: string | null = null, format = "plain";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        videoUrl = body.url || body.video_id;
        format = body.format || "plain";
      } catch {
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

  // Telegram Webhook
  if (path === "/webhook" && req.method === "POST") {
    if (!BOT_TOKEN) return new Response("No BOT_TOKEN", { status: 500 });
    try {
      const update = await req.json();
      if (update.message?.text) await handleMessage(update.message);
      if (update.callback_query) await handleCallback(update.callback_query);
      return new Response("OK", { status: 200 });
    } catch {
      return new Response("Error", { status: 500 });
    }
  }

  // Root
  if (path === "/") {
    return new Response(`<!DOCTYPE html><html><head><title>Transcript Forever</title>
<style>body{font-family:-apple-system,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0d1117;color:#c9d1d9}h1{color:#58a6ff}code{background:#161b22;padding:2px 6px;border-radius:4px;color:#f0883e}pre{background:#161b22;padding:16px;border-radius:8px}.ep{background:#161b22;padding:16px;border-radius:8px;margin:12px 0;border-left:3px solid #58a6ff}.m{color:#3fb950;font-weight:bold}a{color:#58a6ff}</style></head><body>
<h1>🎬 Transcript Forever</h1><p>Free YouTube Transcript API + Telegram Bot</p><p>Runs on <b>Deno Deploy</b> (free, 100k req/month)</p>
<h2>API</h2>
<div class="ep"><p><span class="m">GET</span> <code>/api/transcript?url=URL&format=plain</code></p></div>
<div class="ep"><p><span class="m">POST</span> <code>/api/transcript</code></p><pre>{"url":"URL","format":"timestamps"}</pre></div>
<p>Formats: plain, timestamps, paragraphs, summary, srt</p>
<p><a href="/api/health">Health</a> · <a href="/api/formats">Formats</a></p>
</body></html>`, { headers: { "Content-Type": "text/html" } });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS_HEADERS });
});
