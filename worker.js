/**
 * Transcript Forever — v1.4.0
 * 
 * Uses YouTube InnerTube API (more reliable than page scraping)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function extractVideoId(text) {
  if (!text) return null;
  text = text.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function fetchTranscriptDirect(videoId) {
  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Use YouTube's InnerTube API to get player data
  const playerBody = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
    videoId: videoId,
  };

  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'User-Agent': agent,
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00',
    },
    body: JSON.stringify(playerBody),
  });

  if (!playerRes.ok) {
    throw new Error(`InnerTube API failed: ${playerRes.status}`);
  }

  const playerData = await playerRes.json();

  // Check for errors
  if (playerData.playabilityStatus?.status === 'ERROR') {
    throw new Error(playerData.playabilityStatus.reason || 'Video unavailable');
  }

  // Get caption tracks
  const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    // Fallback: try page scraping
    return await fetchFromPage(videoId, agent);
  }

  // Pick best track
  let track = captionTracks.find(t => t.languageCode === 'hi')
    || captionTracks.find(t => t.languageCode === 'en')
    || captionTracks[0];

  // Download caption XML
  let captionUrl = track.baseUrl;
  if (captionUrl) {
    captionUrl = captionUrl.replace(/\\u0026/g, '&');
    captionUrl = captionUrl.replace(/&fmt=json3/, '&fmt=srv3');
  }

  const captionRes = await fetch(captionUrl, { headers: { 'User-Agent': agent } });
  if (!captionRes.ok) throw new Error(`Caption download failed: ${captionRes.status}`);

  const xml = await captionRes.text();
  return parseCaptionXml(xml, track.languageCode || 'unknown');
}

async function fetchFromPage(videoId, agent) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': agent, 'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8' },
  });
  const html = await res.text();

  let tracks = null;
  
  // Try multiple patterns
  for (const regex of [
    /"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/,
    /"captionTracks":(\[[\s\S]*?\])/,
    /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*var\s/,
  ]) {
    const match = html.match(regex);
    if (match) {
      try {
        if (regex.source.includes('ytInitial')) {
          const pr = JSON.parse(match[1]);
          tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        } else {
          tracks = JSON.parse(match[1]);
        }
        if (tracks && tracks.length > 0) break;
      } catch {}
    }
  }

  if (!tracks || tracks.length === 0) {
    throw new Error('No captions found for this video');
  }

  let track = tracks.find(t => t.languageCode === 'hi')
    || tracks.find(t => t.languageCode === 'en')
    || tracks[0];

  let captionUrl = track.baseUrl.replace(/\\u0026/g, '&');
  const captionRes = await fetch(captionUrl, { headers: { 'User-Agent': agent } });
  if (!captionRes.ok) throw new Error(`Caption download failed: ${captionRes.status}`);

  const xml = await captionRes.text();
  return parseCaptionXml(xml, track.languageCode || 'unknown');
}

function parseCaptionXml(xml, lang) {
  const segments = [];
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[3]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
    if (text) segments.push({ text, start: parseFloat(match[1]), duration: parseFloat(match[2]) });
  }
  if (segments.length === 0) throw new Error('Transcript is empty');
  return { segments, language: lang };
}

// ── Formatters ──────────────────────────────────────────────

function formatPlain(d) { return d.map(e => e.text).join(' '); }

function formatTimestamped(d) {
  return d.map(e => {
    const t = Math.floor(e.start), h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
    return `[${h > 0 ? h+':' : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}] ${e.text}`;
  }).join('\n');
}

function formatParagraphs(d) {
  const p = []; let c = [];
  for (let i = 0; i < d.length; i++) {
    c.push(d[i].text);
    if (i < d.length-1 && (d[i+1].start - d[i].start - d[i].duration) >= 5) { p.push(c.join(' ')); c = []; }
  }
  if (c.length) p.push(c.join(' '));
  return p.join('\n\n');
}

function formatSummary(d) {
  const a = d.map(e => e.text).join(' '), w = a.split(' ');
  if (w.length <= 500) return a;
  const s = Math.ceil(w.length/500);
  return w.filter((_, i) => i % s === 0).join(' ');
}

function formatSrt(d) {
  return d.map((e, i) => {
    const f = s => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`; };
    return `${i+1}\n${f(e.start)} --> ${f(e.start+e.duration)}\n${e.text}\n`;
  }).join('\n');
}

const FORMATTERS = { plain: formatPlain, timestamps: formatTimestamped, paragraphs: formatParagraphs, summary: formatSummary, srt: formatSrt };

// ── Telegram API ────────────────────────────────────────────

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMsg(token, chatId, text, kb) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (kb) body.reply_markup = kb;
  return tg(token, 'sendMessage', body);
}

async function editMsg(token, chatId, msgId, text, kb) {
  const body = { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML' };
  if (kb) body.reply_markup = kb;
  return tg(token, 'editMessageText', body);
}

async function answerCb(token, cbId, text) {
  return tg(token, 'answerCallbackQuery', { callback_query_id: cbId, text });
}

// ── Handlers ────────────────────────────────────────────────

async function handleMessage(token, message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text === '/start' || text === '/help') {
    await sendMsg(token, chatId,
      '🎬 <b>Transcript Forever</b>\n\nSend a YouTube link → get the transcript.\n\n' +
      'URLs: youtube.com/watch?v=ID, youtu.be/ID, shorts/ID\n' +
      'API: <code>/api/transcript?url=URL&format=plain</code>'
    );
    return;
  }

  let url = null;
  if (text.includes('youtube.com') || text.includes('youtu.be')) {
    url = text.split(/\s+/).find(w => w.includes('youtube.com') || w.includes('youtu.be'));
  }
  if (!url) { await sendMsg(token, chatId, 'Send a YouTube URL like:\n<code>https://youtube.com/watch?v=dQw4w9WgXcQ</code>'); return; }

  const videoId = extractVideoId(url);
  if (!videoId) { await sendMsg(token, chatId, '❌ Invalid YouTube URL'); return; }

  const loading = await sendMsg(token, chatId, '⏳ Fetching transcript...');

  try {
    const result = await fetchTranscriptDirect(videoId);
    const data = result.segments;
    const wc = data.reduce((s, e) => s + e.text.split(' ').length, 0);

    const kb = { inline_keyboard: [
      [{ text: '📝 Plain Text', callback_data: `plain:${videoId}` }, { text: '⏱ Timestamps', callback_data: `timestamps:${videoId}` }],
      [{ text: '📄 Paragraphs', callback_data: `paragraphs:${videoId}` }, { text: '📊 Summary', callback_data: `summary:${videoId}` }],
      [{ text: '🎬 SRT Subtitle', callback_data: `srt:${videoId}` }],
    ]};

    await editMsg(token, chatId, loading.result.message_id,
      `✅ <b>Transcript found</b>\n📊 ${wc} words · ${data.length} segments\n\nChoose format:`, kb);
  } catch (err) {
    await editMsg(token, chatId, loading.result.message_id, `❌ ${err.message}`);
  }
}

async function handleCallback(token, callback) {
  const chatId = callback.message.chat.id;
  const msgId = callback.message.message_id;
  const parts = callback.data.split(':');
  const fmt = parts[0], videoId = parts.slice(1).join(':');

  await answerCb(token, callback.id, `Generating ${fmt}...`);

  try {
    const result = await fetchTranscriptDirect(videoId);
    const output = (FORMATTERS[fmt] || formatPlain)(result.segments);

    if (output.length > 4000) {
      const lines = output.split('\n'); const chunks = []; let cur = '';
      for (const line of lines) {
        if (cur.length + line.length + 1 > 3900) { chunks.push(cur); cur = line; }
        else cur += (cur ? '\n' : '') + line;
      }
      if (cur) chunks.push(cur);
      await editMsg(token, chatId, msgId, chunks[0]);
      for (let i = 1; i < chunks.length; i++) await sendMsg(token, chatId, chunks[i]);
    } else {
      await editMsg(token, chatId, msgId, output);
    }
  } catch (err) {
    await editMsg(token, chatId, msgId, `❌ Error: ${err.message}`);
  }
}

// ── API ─────────────────────────────────────────────────────

async function handleApiTranscript(request) {
  const url = new URL(request.url);
  let videoUrl, format;
  if (request.method === 'POST') {
    try { const b = await request.json(); videoUrl = b.url || b.video_id; format = b.format || 'plain'; }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS }); }
  } else {
    videoUrl = url.searchParams.get('url') || url.searchParams.get('video_id');
    format = url.searchParams.get('format') || 'plain';
  }
  if (!videoUrl) return new Response(JSON.stringify({ error: 'Missing url', usage: { GET: '/api/transcript?url=URL&format=plain', POST: '{"url":"URL","format":"plain"}' } }), { status: 400, headers: CORS_HEADERS });
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: CORS_HEADERS });
  if (!FORMATTERS[format]) return new Response(JSON.stringify({ error: 'Invalid format', available: Object.keys(FORMATTERS) }), { status: 400, headers: CORS_HEADERS });

  try {
    const result = await fetchTranscriptDirect(videoId);
    const data = result.segments;
    const output = FORMATTERS[format](data);
    const wc = data.reduce((s, e) => s + e.text.split(' ').length, 0);
    return new Response(JSON.stringify({ success: true, video_id: videoId, format, language: result.language, word_count: wc, segment_count: data.length, transcript: output }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed', message: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

// ── Entry ───────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (path === '/api/health') return new Response(JSON.stringify({ status: 'ok', version: '1.4.0', service: 'Transcript Forever' }), { status: 200, headers: CORS_HEADERS });
    if (path === '/api/formats') return new Response(JSON.stringify({ formats: Object.keys(FORMATTERS) }), { status: 200, headers: CORS_HEADERS });
    if (path === '/api/transcript') return handleApiTranscript(request);
    if (path === '/webhook' && request.method === 'POST') {
      const token = env.BOT_TOKEN;
      if (!token) return new Response('No BOT_TOKEN', { status: 500 });
      try {
        const update = await request.json();
        if (update.message?.text) await handleMessage(token, update.message);
        if (update.callback_query) await handleCallback(token, update.callback_query);
        return new Response('OK', { status: 200 });
      } catch { return new Response('Error', { status: 500 }); }
    }
    if (path === '/') return new Response('<!DOCTYPE html><html><head><title>Transcript Forever</title></head><body><h1>🎬 Transcript Forever</h1><p>YouTube Transcript API + Telegram Bot</p><p><code>GET /api/transcript?url=URL&format=plain</code></p><p><a href="/api/health">Health</a></p></body></html>', { headers: { 'Content-Type': 'text/html' } });
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });
  },
};
