import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SERIAL_NUMBER_PATTERN,
  extractSerialNumber,
  parseVisionReply,
} from "./extract.ts";

test("extracts a labeled serial matching the required scheme", () => {
  const r = extractSerialNumber(
    "Typenschild\nModell MX-440\nSeriennummer: SS-24.12345-884P\nMade in Germany",
  );
  assert.equal(r.serial, "SS-24.12345-884P");
  assert.equal(r.confidence, "high");
});

test("accepts spaces, parentheses, hyphens, and plus in the prefix", () => {
  const r = extractSerialNumber(
    "SEESCHIFF Type Label\nS/N: AB (12)+X-123.123456-12345\nVoltage 24V",
  );
  assert.equal(r.serial, "AB (12)+X-123.123456-12345");
});

test("parses vision model reply format", () => {
  const r = parseVisionReply(
    "OCR: Typenschild Seeschiff\nSeriennummer: 7K-52.55201-42P\nSERIAL: 7K-52.55201-42P",
  );
  assert.equal(r.serial, "7K-52.55201-42P");
  assert.equal(r.matchedBy, "vision:SERIAL");
});

test("rejects previous serial formats that do not match the scheme", () => {
  const r = extractSerialNumber(
    "Typenschild\nSeriennummer: SS-2024-88421\nS/N: AB12-99881",
  );
  assert.equal(r.serial, null);
  assert.equal(r.confidence, "none");
});

test("requires the whole candidate to match", () => {
  assert.equal(SERIAL_NUMBER_PATTERN.test("AB-12.1234-12P"), true);
  assert.equal(SERIAL_NUMBER_PATTERN.test("AB-12.1234-12P extra"), false);
  assert.equal(SERIAL_NUMBER_PATTERN.test("prefix AB-12.1234-12P"), true);
  assert.equal(SERIAL_NUMBER_PATTERN.test("AB-1.1234-12"), false);
  assert.equal(SERIAL_NUMBER_PATTERN.test("AB-12.1234-12p"), false);
});
