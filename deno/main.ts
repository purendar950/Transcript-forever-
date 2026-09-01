/**
 * Transcript Forever — Deno Deploy v2.1
 * Uses YouTube InnerTube API (Android client) to get captions
 */

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

// ── Transcript ──────────────────────────────────────────────

function extractVideoId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

interface Seg { text: string; start: number; duration: number; }

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "").replace(/\n/g, " ").trim();
}

async function fetchTranscript(videoId: string): Promise<{ segments: Seg[]; language: string }> {
  // Step 1: InnerTube Android player API
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
  });

  if (!res.ok) throw new Error(`InnerTube failed: ${res.status}`);
  const data = await res.json();

  if (data.playabilityStatus?.status === "ERROR") {
    throw new Error(data.playabilityStatus.reason || "Video unavailable");
  }

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) throw new Error("No captions found for this video");

  // Pick best track
  const track = tracks.find((t: any) => t.languageCode === "hi")
    || tracks.find((t: any) => t.languageCode === "en")
    || tracks[0];

  const lang = track.languageCode || "unknown";

  // Step 2: Download caption XML
  const captionUrl = track.baseUrl.replace(/\\u0026/g, "&");
  const capRes = await fetch(captionUrl, {
    headers: { "User-Agent": "com.google.android.youtube/20.10.38" },
  });

  if (!capRes.ok) throw new Error(`Caption download failed: ${capRes.status}`);
  const xml = await capRes.text();
  if (!xml || xml.length < 10) throw new Error("Caption response empty — YouTube may be rate limiting");

  // Step 3: Parse XML (supports all YouTube XML formats)
  const segments: Seg[] = [];
  
  // Strategy 1: <text start="s" dur="s">text</text> (classic)
  let regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXml(match[3]);
    if (text) segments.push({ text, start: parseFloat(match[1]), duration: parseFloat(match[2]) });
  }

  // Strategy 2: <p t="ms" d="ms">text</p> (srv3 format)
  if (segments.length === 0) {
    regex = /<p t="([^"]*)"(?:\s+d="([^"]*)")?[^>]*>([^<]*(?:<\/[^>]*>[^<]*)*)<\/p>/g;
    while ((match = regex.exec(xml)) !== null) {
      const inner = match[3];
      // Strip all tags to get text
      const text = decodeXml(inner.replace(/<[^>]*>/g, ' '));
      if (text) segments.push({ text, start: parseInt(match[1]) / 1000, duration: parseInt(match[2] || '3000') / 1000 });
    }
  }

  // Strategy 3: <p t="ms"> with <s> children
  if (segments.length === 0) {
    // Extract all <p> blocks, then extract text from <s> children
    const pBlocks = xml.match(/<p[^>]*t="[^"]*"[^>]*>[\s\S]*?<\/p>/g) || [];
    for (const block of pBlocks) {
      const tMatch = block.match(/t="([^"]*)"/);
      const dMatch = block.match(/d="([^"]*)"/);
      // Get all text from <s> tags or raw text
      const sTexts = (block.match(/<s[^>]*>([^<]*)<\/s>/g) || []).map(s => s.replace(/<[^>]*>/g, ''));
      const rawText = sTexts.length > 0 ? sTexts.join('') : block.replace(/<[^>]*>/g, '');
      const text = decodeXml(rawText);
      if (text && tMatch) segments.push({ text, start: parseInt(tMatch[1]) / 1000, duration: parseInt(dMatch?.[1] || '3000') / 1000 });
    }
  }

  if (segments.length === 0) throw new Error("Transcript is empty");
  return { segments, language: lang };
}

// ── Formatters ──────────────────────────────────────────────

const F = {
  plain: (d: Seg[]) => d.map(e => e.text).join(" "),
  timestamps: (d: Seg[]) => d.map(e => {
    const t = Math.floor(e.start), h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
    return `[${h > 0 ? h+":" : ""}${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}] ${e.text}`;
  }).join("\n"),
  paragraphs: (d: Seg[]) => {
    const p: string[][] = []; let c: string[] = [];
    for (let i = 0; i < d.length; i++) {
      c.push(d[i].text);
      if (i < d.length-1 && (d[i+1].start - d[i].start - d[i].duration) >= 5) { p.push(c); c = []; }
    }
    if (c.length) p.push(c);
    return p.map(x => x.join(" ")).join("\n\n");
  },
  summary: (d: Seg[]) => {
    const a = d.map(e => e.text).join(" "), w = a.split(" ");
    if (w.length <= 500) return a;
    const s = Math.ceil(w.length / 500);
    return w.filter((_, i) => i % s === 0).join(" ");
  },
  srt: (d: Seg[]) => d.map((e, i) => {
    const f = (s: number) => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")},${String(ms).padStart(3,"0")}`; };
    return `${i+1}\n${f(e.start)} --> ${f(e.start+e.duration)}\n${e.text}\n`;
  }).join("\n"),
};

// ── Telegram ────────────────────────────────────────────────

async function tg(m: string, b: any) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return r.json();
}

async function sendMsg(cid: number, text: string, kb?: any) { return tg("sendMessage", { chat_id: cid, text, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }); }
async function editMsg(cid: number, mid: number, text: string, kb?: any) { return tg("editMessageText", { chat_id: cid, message_id: mid, text, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }); }
async function answerCb(cbId: string, text: string) { return tg("answerCallbackQuery", { callback_query_id: cbId, text }); }

// ── Handlers ────────────────────────────────────────────────

async function handleMessage(msg: any) {
  const cid = msg.chat.id, text = (msg.text || "").trim();
  if (text === "/start" || text === "/help") {
    await sendMsg(cid, "🎬 <b>Transcript Forever</b>\n\nSend a YouTube link → get the transcript.\n\nAPI: <code>/api/transcript?url=URL&format=plain</code>");
    return;
  }

  let url: string | null = null;
  if (text.includes("youtube.com") || text.includes("youtu.be")) {
    url = text.split(/\s+/).find(w => w.includes("youtube.com") || w.includes("youtu.be")) || null;
  }
  if (!url) { await sendMsg(cid, 'Send a YouTube URL like:\n<code>https://youtube.com/watch?v=dQw4w9WgXcQ</code>'); return; }

  const videoId = extractVideoId(url);
  if (!videoId) { await sendMsg(cid, "❌ Invalid YouTube URL"); return; }

  const loading = await sendMsg(cid, "⏳ Fetching transcript...");

  try {
    const { segments: data, language } = await fetchTranscript(videoId);
    const wc = data.reduce((s, e) => s + e.text.split(" ").length, 0);
    const kb = { inline_keyboard: [
      [{ text: "📝 Plain Text", callback_data: `plain:${videoId}` }, { text: "⏱ Timestamps", callback_data: `timestamps:${videoId}` }],
      [{ text: "📄 Paragraphs", callback_data: `paragraphs:${videoId}` }, { text: "📊 Summary", callback_data: `summary:${videoId}` }],
      [{ text: "🎬 SRT", callback_data: `srt:${videoId}` }],
    ]};
    await editMsg(cid, loading.result.message_id, `✅ <b>Transcript found</b>\n📊 ${wc} words · ${data.length} segments\n\nChoose format:`, kb);
  } catch (err: any) {
    await editMsg(cid, loading.result.message_id, `❌ ${err.message}`);
  }
}

async function handleCallback(cb: any) {
  const cid = cb.message.chat.id, mid = cb.message.message_id;
  const [fmt, ...vidParts] = cb.data.split(":");
  const videoId = vidParts.join(":");

  await answerCb(cb.id, `Generating ${fmt}...`);

  try {
    const { segments } = await fetchTranscript(videoId);
    const output = (F as any)[fmt]?.(segments) || F.plain(segments);

    if (output.length > 4000) {
      const lines = output.split("\n"); const chunks: string[] = []; let cur = "";
      for (const l of lines) { if (cur.length + l.length + 1 > 3900) { chunks.push(cur); cur = l; } else cur += (cur ? "\n" : "") + l; }
      if (cur) chunks.push(cur);
      await editMsg(cid, mid, chunks[0]);
      for (let i = 1; i < chunks.length; i++) await sendMsg(cid, chunks[i]);
    } else {
      await editMsg(cid, mid, output);
    }
  } catch (err: any) {
    await editMsg(cid, mid, `❌ Error: ${err.message}`);
  }
}

// ── Entry Point ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url), path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // API
  if (path === "/api/health") return new Response(JSON.stringify({ status: "ok", version: "2.1.0", platform: "Deno Deploy" }), { headers: CORS });
  if (path === "/api/formats") return new Response(JSON.stringify({ formats: Object.keys(F) }), { headers: CORS });

  if (path === "/api/transcript") {
    let videoUrl: string | null = null, format = "plain";
    if (req.method === "POST") { try { const b = await req.json(); videoUrl = b.url || b.video_id; format = b.format || "plain"; } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); } }
    else { videoUrl = url.searchParams.get("url") || url.searchParams.get("video_id"); format = url.searchParams.get("format") || "plain"; }
    if (!videoUrl) return new Response(JSON.stringify({ error: "Missing url", usage: { GET: "/api/transcript?url=URL&format=plain", POST: '{"url":"URL","format":"plain"}' } }), { status: 400, headers: CORS });
    const videoId = extractVideoId(videoUrl);
    if (!videoId) return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: CORS });
    if (!(F as any)[format]) return new Response(JSON.stringify({ error: "Invalid format", available: Object.keys(F) }), { status: 400, headers: CORS });
    try {
      const { segments, language } = await fetchTranscript(videoId);
      const output = (F as any)[format](segments);
      const wc = segments.reduce((s, e) => s + e.text.split(" ").length, 0);
      return new Response(JSON.stringify({ success: true, video_id: videoId, format, language, word_count: wc, segment_count: segments.length, transcript: output }), { headers: CORS });
    } catch (err: any) { return new Response(JSON.stringify({ error: "Failed", message: err.message }), { status: 500, headers: CORS }); }
  }

  // Webhook
  if (path === "/webhook" && req.method === "POST") {
    if (!BOT_TOKEN) return new Response(JSON.stringify({error:"No BOT_TOKEN configured"}), { status: 500, headers: CORS });
    try { const u = await req.json(); if (u.message?.text) await handleMessage(u.message); if (u.callback_query) await handleCallback(u.callback_query); return new Response("OK", { status: 200 }); }
    catch { return new Response("Error", { status: 500 }); }
  }

  // Root
  if (path === "/") return new Response(`<!DOCTYPE html><html><head><title>Transcript Forever</title></head><body style="font-family:sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0d1117;color:#c9d1d9">
<h1 style="color:#58a6ff">🎬 Transcript Forever</h1><p>YouTube Transcript API + Telegram Bot</p>
<p><code style="background:#161b22;padding:2px 6px;border-radius:4px;color:#f0883e">GET /api/transcript?url=URL&format=plain</code></p>
<p>Formats: plain, timestamps, paragraphs, summary, srt</p>
<p><a href="/api/health" style="color:#58a6ff">Health</a></p></body></html>`, { headers: { "Content-Type": "text/html" } });

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
});

