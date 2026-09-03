import { corsHeaders, parseAllowedOrigins, withCors } from "./cors";
import {
  OCR_PROMPT,
  extractSerialNumber,
  parseVisionReply,
  type ExtractResult,
} from "./extract";

type ScanFormat = "text" | "json";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
const VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const FALLBACK_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function jsonResponse(data: unknown, status = 200, init: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init,
    },
  });
}

function plainText(body: string, status = 200, init: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...init,
    },
  });
}

function wantsJson(request: Request, url: URL): boolean {
  const format = (url.searchParams.get("format") || "").toLowerCase();
  if (format === "json") return true;
  if (format === "text" || format === "plain") return false;
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") && !accept.includes("text/plain");
}

function authorize(request: Request, env: Env): Response | null {
  if (!env.API_KEY) return null;
  const key =
    request.headers.get("X-OCR-Key") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (key !== env.API_KEY) {
    return plainText("Unauthorized", 401);
  }
  return null;
}

async function readImageFromRequest(request: Request): Promise<{
  bytes: Uint8Array;
  mime: string;
} | null> {
  const contentType = request.headers.get("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("image") || form.get("file") || form.get("photo");
    if (!(file instanceof File)) return null;
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Image too large (max 4MB)");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, mime: file.type || "image/jpeg" };
  }

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      image?: string;
      imageBase64?: string;
      dataUrl?: string;
    };
    const raw = body.image || body.imageBase64 || body.dataUrl || "";
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    const mime = match?.[1] || "image/jpeg";
    const b64 = match?.[2] || raw.replace(/^data:[^;]+;base64,/, "");
    if (!b64) return null;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bin.byteLength > MAX_IMAGE_BYTES) throw new Error("Image too large (max 4MB)");
    return { bytes: bin, mime };
  }

  if (contentType.startsWith("image/")) {
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("Image too large (max 4MB)");
    return { bytes: buf, mime: contentType.split(";")[0] };
  }

  return null;
}

function toDataUri(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function runVisionOcr(
  env: Env,
  dataUri: string,
): Promise<{ reply: string; model: string }> {
  try {
    const result = (await env.AI.run(VISION_MODEL, {
      task: "query",
      image: dataUri,
      question: OCR_PROMPT,
      reasoning: false,
      max_tokens: 512,
      temperature: 0.1,
      stream: false,
    })) as { answer?: string; response?: string };

    const reply = (result.answer || result.response || "").trim();
    if (reply) return { reply, model: VISION_MODEL };
  } catch (err) {
    console.warn("Moondream OCR failed, trying Llama vision", err);
  }

  const fallback = (await env.AI.run(FALLBACK_VISION_MODEL, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: 512,
  })) as { response?: string; description?: string };

  const reply = (fallback.response || fallback.description || "").trim();
  return { reply, model: FALLBACK_VISION_MODEL };
}

function formatScanResponse(
  request: Request,
  url: URL,
  result: ExtractResult,
  meta: { model?: string; ms: number },
): Response {
  if (!wantsJson(request, url)) {
    // Plain text: serial only (empty body if not found)
    return plainText(result.serial || "", result.serial ? 200 : 404);
  }

  return jsonResponse({
    serial: result.serial,
    confidence: result.confidence,
    found: Boolean(result.serial),
    rawText: result.rawText,
    matchedBy: result.matchedBy,
    model: meta.model || null,
    durationMs: meta.ms,
  }, result.serial ? 200 : 404);
}

async function handleScan(request: Request, env: Env, url: URL): Promise<Response> {
  const authError = authorize(request, env);
  if (authError) return authError;

  // Dev/test path: POST { "text": "Seriennummer: AB-12.1234-12P" } skips vision
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const clone = request.clone();
    const body = (await clone.json()) as {
      text?: string;
      image?: string;
      imageBase64?: string;
      dataUrl?: string;
    };
    if (body.text && !body.image && !body.imageBase64 && !body.dataUrl) {
      const started = Date.now();
      const result = extractSerialNumber(body.text);
      return formatScanResponse(request, url, result, { ms: Date.now() - started });
    }
  }

  let image: { bytes: Uint8Array; mime: string } | null;
  try {
    image = await readImageFromRequest(request);
  } catch (err) {
    return plainText(err instanceof Error ? err.message : "Invalid image", 400);
  }

  if (!image) {
    return plainText(
      "Missing image. Send multipart field 'image', raw image/*, or JSON { image: dataUrl|base64 }.",
      400,
    );
  }

  const started = Date.now();
  const dataUri = toDataUri(image.bytes, image.mime);
  const { reply, model } = await runVisionOcr(env, dataUri);
  const result = parseVisionReply(reply);
  return formatScanResponse(request, url, result, {
    model,
    ms: Date.now() - started,
  });
}

function handleHealth(): Response {
  return jsonResponse({
    ok: true,
    service: "ocr-scan-component",
    endpoints: {
      "POST /scan": "Upload type-label / Seeschiff photo → serial number (text/plain by default)",
      "POST /scan?format=json": "Same, JSON payload with confidence + OCR text",
      "GET /embed.js": "Embeddable scanner widget for other sites",
      "GET /demo": "Interactive demo page",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, allowed) });
    }

    let response: Response;

    try {
      if (request.method === "GET" && (path === "/" || path === "/health")) {
        response = handleHealth();
      } else if (request.method === "POST" && (path === "/scan" || path === "/api/scan")) {
        response = await handleScan(request, env, url);
      } else if (env.ASSETS) {
        // Static assets: /embed.js, /demo.html, etc.
        const assetUrl =
          path === "/demo" || path === "/demo/"
            ? new URL("/demo.html", url.origin)
            : url;
        response = await env.ASSETS.fetch(new Request(assetUrl, request));
      } else {
        response = plainText("Not found", 404);
      }
    } catch (err) {
      console.error(err);
      response = plainText(
        err instanceof Error ? err.message : "Internal error",
        500,
      );
    }

    return withCors(request, response, allowed);
  },
} satisfies ExportedHandler<Env>;
