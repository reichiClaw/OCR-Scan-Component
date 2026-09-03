/**
 * Serial-number extraction from OCR / vision model text.
 * Tuned for Typenschild / type-label / Seeschiff (marine equipment) plates.
 */

const LABEL_HINTS =
  /\b(seriennummer|serial\s*(?:no|number|#)|s\/?n|snr|fabrikat(?:ions)?nr|werknummer|ident(?:ification)?\s*(?:no|number)|type\s*label|typenschild|seeschiff)\b/i;

const SERIAL_NUMBER_SOURCE =
  String.raw`[(A-Za-z0-9\s)\-+]{2,}-[0-9]{2,3}\.[0-9]{4,6}-[0-9]{2,5}P?`;

/**
 * The required serial-number scheme. Anchors ensure that the complete value,
 * rather than only a substring, conforms to the supplied format.
 */
export const SERIAL_NUMBER_PATTERN = new RegExp(
  `^${SERIAL_NUMBER_SOURCE}$`,
  "i",
);

const SERIAL_NUMBER_SEARCH_PATTERN = new RegExp(SERIAL_NUMBER_SOURCE, "i");
const SERIAL_LABEL_PREFIX =
  /^(?:seriennummer|serial\s*(?:no\.?|number|#)?|s\/?n|snr|fabrikat(?:ions)?nr\.?|werknummer|ident(?:ifikation)?(?:\s*[-.]?\s*n[ro]\.?)?)\s*[:#]?\s*/i;

export type ExtractResult = {
  serial: string | null;
  confidence: "high" | "medium" | "low" | "none";
  rawText: string;
  matchedBy: string | null;
};

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[:#\s]+/, "")
    .replace(/[,;]+$/, "")
    .toUpperCase();
}

function isPlausibleSerial(value: string): boolean {
  return SERIAL_NUMBER_PATTERN.test(value);
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

  for (const line of text.split("\n")) {
    const withoutLabel = line.trim().replace(SERIAL_LABEL_PREFIX, "");
    const match = withoutLabel.match(SERIAL_NUMBER_SEARCH_PATTERN);
    if (!match?.[0]) continue;
    const serial = cleanCandidate(match[0]);
    if (!isPlausibleSerial(serial)) continue;

    const labeled = SERIAL_LABEL_PREFIX.test(line.trim());
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
      matchedBy: SERIAL_NUMBER_PATTERN.source,
    };
  }

  return { serial: null, confidence: "none", rawText: text, matchedBy: null };
}

/** Prompt used for vision OCR of type labels / Seeschiff plates. */
export const OCR_PROMPT = `You are reading a photo of an industrial type label (Typenschild) or Seeschiff / marine equipment nameplate.
Extract ALL visible text exactly as printed.
Then identify the serial number. Look for fields labeled: Seriennummer, Serial Number, Serial No, S/N, SN, SNR, Werknummer, Ident-Nr, Fabrikationsnr.
Only accept a serial number matching this pattern: ${SERIAL_NUMBER_PATTERN.source}
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
