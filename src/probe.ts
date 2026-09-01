/**
 * TEMPORARY diagnostic route. Datacenter IPs get different InnerTube treatment
 * than residential ones, so this reports what each strategy returns when run
 * from inside the deployment. Remove once a working strategy is picked.
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

async function visitorData(): Promise<string | null> {
  try {
    const response = await fetch("https://www.youtube.com/sw.js_data", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const parsed = JSON.parse((await response.text()).replace(/^\)\]\}'/, ""));
    const value = parsed?.[0]?.[2]?.[0]?.[0]?.[13];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function player(
  label: string,
  userAgent: string,
  client: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Attempt> {
  try {
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
      sample: tracks[0]?.baseUrl?.slice(0, 120),
    };
  } catch (error) {
    return { label, error: String(error) };
  }
}

async function watchPage(): Promise<Attempt> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${VIDEO}&hl=en`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await response.text();
    const match = html.match(/"captionTracks":(\[.*?\])/);
    return {
      label: "watch page scrape",
      http: response.status,
      tracks: match ? JSON.parse(match[1].replace(/\\u0026/g, "&")).length : 0,
      sample: match ? match[1].slice(0, 120) : `html ${html.length} bytes`,
    };
  } catch (error) {
    return { label: "watch page scrape", error: String(error) };
  }
}

async function timedText(): Promise<Attempt> {
  try {
    const response = await fetch(
      `https://video.google.com/timedtext?lang=en&v=${VIDEO}&fmt=json3`,
    );
    const body = await response.text();
    return { label: "legacy timedtext", http: response.status, sample: body.slice(0, 120) };
  } catch (error) {
    return { label: "legacy timedtext", error: String(error) };
  }
}

export async function probe(): Promise<Attempt[]> {
  const visitor = await visitorData();
  const results: Attempt[] = [
    { label: "visitorData", sample: visitor ? `${visitor.slice(0, 16)}...` : "none" },
  ];

  results.push(
    await player(
      "ANDROID",
      "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
      {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        androidSdkVersion: 34,
        osName: "Android",
        osVersion: "14",
        platform: "MOBILE",
      },
    ),
  );

  results.push(
    await player(
      "IOS",
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
      {
        clientName: "IOS",
        clientVersion: "20.10.4",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iPhone",
        osVersion: "18.3.2.22D82",
        platform: "MOBILE",
      },
    ),
  );

  results.push(
    await player(
      "ANDROID_VR",
      "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L) gzip",
      {
        clientName: "ANDROID_VR",
        clientVersion: "1.62.27",
        androidSdkVersion: 32,
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        osName: "Android",
        osVersion: "12L",
      },
    ),
  );

  if (visitor) {
    results.push(
      await player(
        "ANDROID + visitorData",
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
        {
          clientName: "ANDROID",
          clientVersion: "20.10.38",
          androidSdkVersion: 34,
          osName: "Android",
          osVersion: "14",
          platform: "MOBILE",
          visitorData: visitor,
        },
        {},
        { "X-Goog-Visitor-Id": visitor },
      ),
    );

    results.push(
      await player(
        "WEB + visitorData",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        {
          clientName: "WEB",
          clientVersion: "2.20250101.00.00",
          platform: "DESKTOP",
          visitorData: visitor,
        },
        {},
        { "X-Goog-Visitor-Id": visitor },
      ),
    );
  }

  results.push(
    await player(
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
      { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", platform: "TV" },
      { thirdParty: { embedUrl: "https://www.youtube.com" } },
    ),
  );

  results.push(
    await player(
      "WEB_EMBEDDED_PLAYER",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20250101.00.00", platform: "DESKTOP" },
      { thirdParty: { embedUrl: "https://www.youtube.com" } },
    ),
  );

  results.push(
    await player(
      "MWEB",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      { clientName: "MWEB", clientVersion: "2.20250101.00.00", platform: "MOBILE" },
    ),
  );

  results.push(await watchPage());
  results.push(await timedText());

  return results;
}
