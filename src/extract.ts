/**
 * Serial-number extraction from OCR / vision model text.
 * Tuned for Typenschild / type-label / Seeschiff (marine equipment) plates.
 */

const LABEL_HINTS =
  /\b(seriennummer|serial\s*(?:no|number|#)|s\/?n|snr|fabrikat(?:ions)?nr|werknummer|ident(?:ification)?\s*(?:no|number)|type\s*label|typenschild|seeschiff)\b/i;

/** Common industrial / marine serial patterns (ordered by specificity). */
const SERIAL_PATTERNS: RegExp[] = [
  // Explicit labels: "Seriennummer: ABC-12345", "S/N: …", "Serial No. …"
  /(?:seriennummer|serial\s*(?:no\.?|number|#)|s\/?n|snr|fabrikat(?:ions)?nr\.?|werknummer)\s*[:.#]?\s*([A-Z0-9][A-Z0-9./\-_]{3,31})/i,
  // "Ident-Nr." / "Identifikation"
  /(?:ident(?:ifikation)?(?:\s*[-.]?\s*n[ro]\.?|#)?)\s*[:.#]?\s*([A-Z0-9][A-Z0-9./\-_]{3,31})/i,
  // Seeschiff / ship / IMO-adjacent plate lines
  /(?:seeschiff|schiff|vessel|hull|imo)\s*(?:nr\.?|no\.?|#|:)?\s*([A-Z0-9][A-Z0-9./\-_]{3,31})/i,
  // Bare serial-looking tokens near type-label context (fallback)
  /\b([A-Z]{1,4}[-_/]?\d{4,}[A-Z0-9\-_/]*)\b/,
  /\b(\d{2,}[-_/][A-Z0-9]{2,}(?:[-_/][A-Z0-9]+)?)\b/i,
  /\b([A-Z0-9]{6,24})\b/,
];

const NOISE = new Set([
  "TYPENSCHILD",
  "TYPELABEL",
  "TYPE",
  "LABEL",
  "SEESCHIFF",
  "SERIAL",
  "NUMBER",
  "SERIENNUMMER",
  "MADE",
  "GERMANY",
  "CHINA",
  "MODEL",
  "MODELL",
]);

export type ExtractResult = {
  serial: string | null;
  confidence: "high" | "medium" | "low" | "none";
  rawText: string;
  matchedBy: string | null;
};

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[:.#\-\s]+/, "")
    .replace(/[,;]+$/, "")
    .toUpperCase();
}

function isPlausibleSerial(value: string): boolean {
  if (!value || value.length < 4 || value.length > 32) return false;
  if (NOISE.has(value)) return false;
  // Must contain at least one digit
  if (!/\d/.test(value)) return false;
  // Reject pure years / tiny numbers
  if (/^(19|20)\d{2}$/.test(value)) return false;
  return true;
}

/**
 * Pull a serial number from free-form OCR text.
 * Prefer labeled fields; fall back to plausible tokens when the plate context matches.
 */
export function extractSerialNumber(rawText: string): ExtractResult {
  const text = (rawText || "").replace(/\r/g, "\n").trim();
  if (!text) {
    return { serial: null, confidence: "none", rawText: "", matchedBy: null };
  }

  for (const pattern of SERIAL_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const serial = cleanCandidate(match[1]);
    if (!isPlausibleSerial(serial)) continue;

    const labeled = /seriennummer|serial|s\/?n|snr|ident|werknummer|fabrikat/i.test(
      pattern.source,
    );
    const hasHint = LABEL_HINTS.test(text);
    const confidence: ExtractResult["confidence"] = labeled
      ? "high"
      : hasHint
        ? "medium"
        : "low";

    return {
      serial,
      confidence,
      rawText: text,
      matchedBy: pattern.source.slice(0, 80),
    };
  }

  return { serial: null, confidence: "none", rawText: text, matchedBy: null };
}

/** Prompt used for vision OCR of type labels / Seeschiff plates. */
export const OCR_PROMPT = `You are reading a photo of an industrial type label (Typenschild) or Seeschiff / marine equipment nameplate.
Extract ALL visible text exactly as printed.
Then identify the serial number. Look for fields labeled: Seriennummer, Serial Number, Serial No, S/N, SN, SNR, Werknummer, Ident-Nr, Fabrikationsnr.
Reply in this exact format (no markdown):
OCR: <all visible text on one or more lines>
SERIAL: <the serial number only, or NONE if not found>`;

/** Parse SERIAL: line from the vision model reply. */
export function parseVisionReply(reply: string): ExtractResult {
  const text = (reply || "").trim();
  const serialLine = text.match(/^\s*SERIAL:\s*(.+)\s*$/im);
  const ocrBlock = text.match(/^\s*OCR:\s*([\s\S]*?)(?=^\s*SERIAL:)/im);

  const ocrText = (ocrBlock?.[1] || text).trim();
  const claimed = serialLine?.[1]?.trim();

  if (claimed && !/^none$/i.test(claimed) && isPlausibleSerial(cleanCandidate(claimed))) {
    return {
      serial: cleanCandidate(claimed),
      confidence: "high",
      rawText: ocrText,
      matchedBy: "vision:SERIAL",
    };
  }

  return extractSerialNumber(ocrText || text);
}
