/**
 * Transcript Forever — YouTube Transcript API + Telegram Bot
 * 
 * Deployed on Cloudflare Workers (FREE — 100k req/day)
 * 
 * Features:
 *   1. Telegram Bot — users send YouTube URLs, get transcripts
 *   2. HTTP API — other projects call GET/POST for transcripts
 *   3. Always-on — runs 24/7 on Cloudflare's edge network
 *   4. Transcript caching — avoids YouTube rate limits
 */

import { YoutubeTranscript } from 'youtube-transcript';

// ── Config ──────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ── In-Memory Cache ─────────────────────────────────────────
// Cloudflare Workers have isolated caches, but we use a simple
// Map per request. For persistent caching across requests,
// we'll use the Cache API.
const CACHE_TTL = 3600000; // 1 hour

async function getCachedTranscript(videoId) {
  const cacheKey = `transcript:${videoId}`;
  const cache = caches.default;
  const request = new Request(`https://cache/${cacheKey}`);
  const cached = await cache.match(request);
  if (cached) {
    return await cached.json();
  }
  return null;
}

async function setCachedTranscript(videoId, data) {
  const cacheKey = `transcript:${videoId}`;
  const cache = caches.default;
  const request = new Request(`https://cache/${cacheKey}`);
  const response = new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
  await cache.put(request, response);
}

// ── Transcript Engine ───────────────────────────────────────

function extractVideoId(text) {
  if (!text) return null;
  text = text.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

async function fetchTranscript(videoId) {
  // Check cache first
  const cached = await getCachedTranscript(videoId);
  if (cached) return cached;

  const raw = await YoutubeTranscript.fetchTranscript(videoId);
  const data = raw.map((e) => ({
    text: e.text,
    start: e.offset / 1000,
    duration: (e.duration || 3000) / 1000,
  }));

  // Cache for 1 hour
  await setCachedTranscript(videoId, data);
  return data;
}

function formatPlain(data) {
  return data.map((e) => e.text).join(' ');
}

function formatTimestamped(data) {
  return data
    .map((e) => {
      const total = Math.floor(e.start);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const ts = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
      return `[${ts}] ${e.text}`;
    })
    .join('\n');
}

function formatParagraphs(data) {
  const paras = [];
  let cur = [];
  for (let i = 0; i < data.length; i++) {
    cur.push(data[i].text);
    if (i < data.length - 1) {
      const gap = data[i + 1].start - data[i].start - data[i].duration;
      if (gap >= 5.0) {
        paras.push(cur.join(' '));
        cur = [];
      }
    }
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras.join('\n\n');
}

function formatSummary(data) {
  const all = data.map((e) => e.text).join(' ');
  const words = all.split(' ');
  if (words.length <= 500) return all;
  const step = Math.ceil(words.length / 500);
  return words.filter((_, i) => i % step === 0).join(' ');
}

function formatSrt(data) {
  return data
    .map((e, i) => {
      const fmtTime = (sec) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };
      const start = e.start;
      const end = e.start + e.duration;
      return `${i + 1}\n${fmtTime(start)} --> ${fmtTime(end)}\n${e.text}\n`;
    })
    .join('\n');
}

const FORMATTERS = {
  plain: formatPlain,
  timestamps: formatTimestamped,
  paragraphs: formatParagraphs,
  summary: formatSummary,
  srt: formatSrt,
};

// ── Telegram API ────────────────────────────────────────────

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(token, chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(token, 'sendMessage', body);
}

async function editMessage(token, chatId, messageId, text, replyMarkup) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(token, 'editMessageText', body);
}

async function answerCallback(token, callbackQueryId, text) {
  return tg(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

// ── Telegram Handlers ───────────────────────────────────────

async function handleMessage(token, message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text === '/start') {
    await sendMessage(token, chatId,
      '🎬 <b>Transcript Forever</b>\n\n' +
      'Send a YouTube link → get the transcript instantly.\n\n' +
      'Also available as an API:\n' +
      '<code>GET /api/transcript?url=YOUTUBE_URL</code>\n\n' +
      'Formats: plain, timestamps, paragraphs, summary, srt'
    );
    return;
  }

  if (text === '/help') {
    await sendMessage(token, chatId,
      '📖 <b>How to use:</b>\n\n' +
      '1. Send a YouTube URL\n' +
      '2. Choose format\n' +
      '3. Get transcript\n\n' +
      '<b>Supported URLs:</b>\n' +
      '• youtube.com/watch?v=ID\n' +
      '• youtu.be/ID\n' +
      '• youtube.com/shorts/ID\n\n' +
      '<b>API Usage:</b>\n' +
      '<code>GET /api/transcript?url=URL&format=plain</code>'
    );
    return;
  }

  // Find YouTube URL
  let url = null;
  if (text.includes('youtube.com') || text.includes('youtu.be')) {
    url = text.split(/\s+/).find((w) => w.includes('youtube.com') || w.includes('youtu.be'));
  }

  if (!url) {
    await sendMessage(token, chatId,
      'Send a YouTube URL like:\n<code>https://youtube.com/watch?v=dQw4w9WgXcQ</code>'
    );
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    await sendMessage(token, chatId, '❌ Invalid YouTube URL');
    return;
  }

  const loading = await sendMessage(token, chatId, '⏳ Fetching transcript...');

  try {
    const data = await fetchTranscript(videoId);
    if (!data || data.length === 0) {
      await editMessage(token, chatId, loading.result.message_id, '❌ No transcript available.');
      return;
    }

    const wordCount = data.reduce((sum, e) => sum + e.text.split(' ').length, 0);

    const kb = {
      inline_keyboard: [
        [
          { text: '📝 Plain Text', callback_data: `plain:${videoId}` },
          { text: '⏱ Timestamps', callback_data: `timestamps:${videoId}` },
        ],
        [
          { text: '📄 Paragraphs', callback_data: `paragraphs:${videoId}` },
          { text: '📊 Summary', callback_data: `summary:${videoId}` },
        ],
        [
          { text: '🎬 SRT Subtitle', callback_data: `srt:${videoId}` },
        ],
      ],
    };

    await editMessage(token, chatId, loading.result.message_id,
      `✅ <b>Transcript found</b>\n📊 ${wordCount} words · ${data.length} segments\n\nChoose format:`,
      kb
    );
  } catch (err) {
    await editMessage(token, chatId, loading.result.message_id,
      `❌ No transcript available.\n\n${err.message || 'Unknown error'}`
    );
  }
}

async function handleCallback(token, callback) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const parts = callback.data.split(':');
  const fmt = parts[0];
  const videoId = parts.slice(1).join(':');

  await answerCallback(token, callback.id, `Generating ${fmt}...`);

  try {
    const data = await fetchTranscript(videoId);
    const formatter = FORMATTERS[fmt] || formatPlain;
    let result = formatter(data);

    if (result.length > 4000) {
      const lines = result.split('\n');
      const chunks = [];
      let cur = '';
      for (const line of lines) {
        if (cur.length + line.length + 1 > 3900) {
          chunks.push(cur);
          cur = line;
        } else {
          cur += (cur ? '\n' : '') + line;
        }
      }
      if (cur) chunks.push(cur);

      await editMessage(token, chatId, messageId, chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await sendMessage(token, chatId, chunks[i]);
      }
    } else {
      await editMessage(token, chatId, messageId, result);
    }
  } catch (err) {
    await editMessage(token, chatId, messageId, `❌ Error: ${err.message}`);
  }
}

// ── API Handlers ────────────────────────────────────────────

async function handleApiTranscript(request) {
  const url = new URL(request.url);
  let videoUrl, format, lang;

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      videoUrl = body.url || body.video_url || body.video_id;
      format = body.format || 'plain';
      lang = body.lang || 'en';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  } else {
    videoUrl = url.searchParams.get('url') || url.searchParams.get('video_url') || url.searchParams.get('video_id');
    format = url.searchParams.get('format') || 'plain';
    lang = url.searchParams.get('lang') || 'en';
  }

  if (!videoUrl) {
    return new Response(JSON.stringify({
      error: 'Missing parameter',
      usage: {
        GET: '/api/transcript?url=YOUTUBE_URL&format=plain',
        POST: '/api/transcript  { "url": "YOUTUBE_URL", "format": "plain" }',
      },
    }), { status: 400, headers: CORS_HEADERS });
  }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    return new Response(JSON.stringify({ error: 'Invalid YouTube URL' }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  if (!FORMATTERS[format]) {
    return new Response(JSON.stringify({
      error: `Invalid format: ${format}`,
      available: Object.keys(FORMATTERS),
    }), { status: 400, headers: CORS_HEADERS });
  }

  try {
    const data = await fetchTranscript(videoId);
    const formatter = FORMATTERS[format];
    const result = formatter(data);
    const wordCount = data.reduce((sum, e) => sum + e.text.split(' ').length, 0);

    return new Response(JSON.stringify({
      success: true,
      video_id: videoId,
      format,
      word_count: wordCount,
      segment_count: data.length,
      transcript: result,
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Failed to fetch transcript',
      message: err.message,
      video_id: videoId,
    }), { status: 500, headers: CORS_HEADERS });
  }
}

function handleApiHealth() {
  return new Response(JSON.stringify({
    status: 'ok',
    service: 'Transcript Forever',
    version: '1.1.0',
    endpoints: {
      transcript: 'GET/POST /api/transcript?url=URL&format=plain',
      formats: 'GET /api/formats',
      health: 'GET /api/health',
    },
  }), { status: 200, headers: CORS_HEADERS });
}

function handleApiFormats() {
  return new Response(JSON.stringify({
    formats: Object.keys(FORMATTERS).map((f) => ({
      id: f,
      description: {
        plain: 'Clean readable text',
        timestamps: 'Text with [MM:SS] markers',
        paragraphs: 'Split by natural pauses',
        summary: 'Condensed ~500 words',
        srt: 'SRT subtitle file format',
      }[f],
    })),
  }), { status: 200, headers: CORS_HEADERS });
}

// ── Cloudflare Worker Entry Point ───────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── API Routes ──────────────────────────────────────────

    if (path === '/api/health') {
      return handleApiHealth();
    }

    if (path === '/api/formats') {
      return handleApiFormats();
    }

    if (path === '/api/transcript') {
      return handleApiTranscript(request);
    }

    // ── Telegram Webhook ────────────────────────────────────

    if (path === '/webhook' && request.method === 'POST') {
      const token = env.BOT_TOKEN;
      if (!token) {
        return new Response('BOT_TOKEN not configured', { status: 500 });
      }

      try {
        const update = await request.json();

        if (update.message && update.message.text) {
          await handleMessage(token, update.message);
        }

        if (update.callback_query) {
          await handleCallback(token, update.callback_query);
        }

        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('Webhook error:', err);
        return new Response('Error', { status: 500 });
      }
    }

    // ── Root — Landing Page ─────────────────────────────────

    if (path === '/') {
      return new Response(`<!DOCTYPE html>
<html>
<head>
  <title>Transcript Forever</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; background: #0d1117; color: #c9d1d9; }
    h1 { color: #58a6ff; }
    code { background: #161b22; padding: 2px 6px; border-radius: 4px; color: #f0883e; }
    pre { background: #161b22; padding: 16px; border-radius: 8px; overflow-x: auto; }
    a { color: #58a6ff; }
    .endpoint { background: #161b22; padding: 16px; border-radius: 8px; margin: 12px 0; border-left: 3px solid #58a6ff; }
    .method { color: #3fb950; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🎬 Transcript Forever</h1>
  <p>Free YouTube Transcript API + Telegram Bot</p>
  
  <h2>API Endpoints</h2>
  
  <div class="endpoint">
    <p><span class="method">GET</span> <code>/api/transcript</code></p>
    <pre>/api/transcript?url=https://youtube.com/watch?v=ID&format=plain</pre>
  </div>
  
  <div class="endpoint">
    <p><span class="method">POST</span> <code>/api/transcript</code></p>
    <pre>{"url": "https://youtube.com/watch?v=ID", "format": "timestamps"}</pre>
  </div>
  
  <div class="endpoint">
    <p><span class="method">GET</span> <code>/api/formats</code></p>
    <pre>Returns available formats: plain, timestamps, paragraphs, summary, srt</pre>
  </div>
  
  <div class="endpoint">
    <p><span class="method">GET</span> <code>/api/health</code></p>
    <pre>Returns service status</pre>
  </div>

  <h2>Telegram Bot</h2>
  <p>Send a YouTube URL to the bot → get transcript.</p>
  
  <h2>Usage in Your Project</h2>
  <pre>
// JavaScript
const res = await fetch('YOUR_WORKER_URL/api/transcript?url=https://youtube.com/watch?v=abc&format=plain');
const data = await res.json();
console.log(data.transcript);

// Python
import requests
r = requests.get('YOUR_WORKER_URL/api/transcript', params={
    'url': 'https://youtube.com/watch?v=abc',
    'format': 'plain'
})
print(r.json()['transcript'])
  </pre>
  
  <p><a href="/api/health">Check Health</a> · <a href="/api/formats">View Formats</a></p>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // ── 404 ─────────────────────────────────────────────────

    return new Response(JSON.stringify({
      error: 'Not found',
      endpoints: {
        root: 'GET /',
        health: 'GET /api/health',
        formats: 'GET /api/formats',
        transcript: 'GET/POST /api/transcript?url=URL&format=plain',
        webhook: 'POST /webhook (Telegram)',
      },
    }), { status: 404, headers: CORS_HEADERS });
  },
};
