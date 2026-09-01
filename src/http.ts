export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

export function text(body: string, contentType: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      ...init.headers,
    },
  });
}

export function clientIp(request: Request, info?: { remoteAddr?: { hostname?: string } }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? info?.remoteAddr?.hostname ?? "unknown";
}
