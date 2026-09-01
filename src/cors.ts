export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "" || raw.trim() === "*") return ["*"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(
  request: Request,
  allowedOrigins: string[],
): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const allowAll = allowedOrigins.includes("*");
  const allowOrigin = allowAll
    ? origin || "*"
    : allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0] || "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-OCR-Key, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(
  request: Request,
  response: Response,
  allowedOrigins: string[],
): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, allowedOrigins);
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v as string);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
