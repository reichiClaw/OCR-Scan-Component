import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSerialNumber, parseVisionReply } from "./extract.ts";

test("extracts labeled German Seriennummer", () => {
  const r = extractSerialNumber(
    "Typenschild\nModell MX-440\nSeriennummer: SS-2024-88421\nMade in Germany",
  );
  assert.equal(r.serial, "SS-2024-88421");
  assert.equal(r.confidence, "high");
});

test("extracts S/N from Seeschiff plate text", () => {
  const r = extractSerialNumber(
    "SEESCHIFF Type Label\nS/N: AB12-99881\nVoltage 24V",
  );
  assert.equal(r.serial, "AB12-99881");
});

test("parses vision model reply format", () => {
  const r = parseVisionReply(
    "OCR: Typenschild Seeschiff Seriennummer 7K-55201A\nSERIAL: 7K-55201A",
  );
  assert.equal(r.serial, "7K-55201A");
  assert.equal(r.matchedBy, "vision:SERIAL");
});

test("returns none when no serial present", () => {
  const r = extractSerialNumber("Hello world type label");
  assert.equal(r.serial, null);
  assert.equal(r.confidence, "none");
});
