/**
 * TEMPORARY diagnostic route.
 *
 * YouTube treats datacenter IPs differently from residential ones, so a
 * strategy that works locally can still fail on Deno Deploy. This runs every
 * candidate strategy from inside the deployment and reports what came back.
 * Delete this file and its route once a working strategy is chosen.
 */
const VIDEO = "jNQXAC9IVRw";
const PLAYER = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

interface Attempt {
  label: string;
  http?: number;
  status?: string;
  reason?: string;
  tracks?: number;
  sample?: string;
  error?: string;
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function guard(label: string, run: () => Promise<Attempt>): Promise<Attempt> {
  try {
    return await run();
  } catch (error) {
    return { label, error: String(error).slice(0, 160) };
  }
}

function innertube(
  label: string,
  userAgent: string,
  client: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Attempt> {
  return guard(label, async () => {
    const response = await fetch(PLAYER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.youtube.com",
        ...headers,
      },
      body: JSON.stringify({
        context: { client: { ...client, hl: "en", gl: "US" } },
        videoId: VIDEO,
        contentCheckOk: true,
        racyCheckOk: true,
        ...extra,
      }),
    });
    const body = await response.json();
    const tracks = body?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return {
      label,
      http: response.status,
      status: body?.playabilityStatus?.status,
      reason: body?.playabilityStatus?.reason,
      tracks: tracks.length,
    };
  });
}

function scrape(label: string, url: string, headers: Record<string, string>): Promise<Attempt> {
  return guard(label, async () => {
    const response = await fetch(url, { headers });
    const html = await response.text();
    const match = html.match(/"captionTracks":(\[.*?\])/);
    const count = match ? JSON.parse(match[1].replace(/\\u0026/g, "&")).length : 0;
    return {
      label,
      http: response.status,
      tracks: count,
      sample: count > 0 ? "captionTracks present" : `no captionTracks in ${html.length} bytes`,
    };
  });
}

function json(label: string, url: string, init: RequestInit = {}): Promise<Attempt> {
  return guard(label, async () => {
    const response = await fetch(url, init);
    const body = await response.text();
    return { label, http: response.status, sample: body.slice(0, 180) };
  });
}

export async function probe(): Promise<Attempt[]> {
  const attempts = await Promise.all([
    innertube("innertube ANDROID", ANDROID_UA, {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
      platform: "MOBILE",
    }),
    innertube(
      "innertube WEB + consent cookie",
      CHROME_UA,
      { clientName: "WEB", clientVersion: "2.20250101.00.00", platform: "DESKTOP" },
      {},
      { Cookie: "CONSENT=YES+cb; SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg" },
    ),
    scrape(
      "watch page (chrome ua)",
      `https://www.youtube.com/watch?v=${VIDEO}&hl=en&bpctr=9999999999`,
      {
        "User-Agent": CHROME_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+cb; SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg",
      },
    ),
    scrape("watch page (googlebot ua)", `https://www.youtube.com/watch?v=${VIDEO}&hl=en`, {
      "User-Agent": GOOGLEBOT_UA,
      "Accept-Language": "en-US,en;q=0.9",
    }),
    scrape("embed page", `https://www.youtube.com/embed/${VIDEO}?hl=en`, {
      "User-Agent": CHROME_UA,
      "Accept-Language": "en-US,en;q=0.9",
    }),
    json("invidious nadeko captions list", `https://inv.nadeko.net/api/v1/captions/${VIDEO}`),
    json(
      "invidious nadeko vtt",
      `https://inv.nadeko.net/api/v1/captions/${VIDEO}?label=English`,
    ),
    json("piped private.coffee", `https://api.piped.private.coffee/streams/${VIDEO}`),
    json("kome.ai relay", "https://kome.ai/api/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://kome.ai" },
      body: JSON.stringify({ video_id: VIDEO, format: true }),
    }),
    json(
      "unsigned timedtext",
      `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en&fmt=json3`,
    ),
  ]);

  return attempts;
}
