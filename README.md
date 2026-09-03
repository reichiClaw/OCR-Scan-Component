# OCR Scan Component

Cloudflare Worker + embeddable widget that scans **Typenschild / type labels / Seeschiff** plates, extracts the **serial number**, and returns it as **plain text** for any website or web app.

## Is this possible?

Yes. The Worker accepts a photo (camera or upload), runs vision OCR via **Cloudflare Workers AI**, extracts the serial, and responds with plain text. Other sites integrate via a small `<script>` tag or a direct `POST /scan` API call (CORS enabled).

## Architecture

| Piece | Role |
| --- | --- |
| `POST /scan` | Image in → serial number out (`text/plain` by default) |
| Workers AI (Moondream, Llama vision fallback) | Reads text from the type-label photo |
| `embed.js` | Drop-in camera / upload UI for third-party sites |
| Regex post-processor | Returns only serials matching the required format |

## Quick start

```bash
npm install
npx wrangler login   # once
npm run deploy
```

After deploy, open:

- `https://<your-worker>.workers.dev/demo` — interactive demo
- `https://<your-worker>.workers.dev/embed.js` — embeddable scanner
- `https://<your-worker>.workers.dev/scan` — API

Locally (AI binding requires Cloudflare account / remote flag):

```bash
npm run dev
# or: npx wrangler dev --remote
```

## API

### `POST /scan` → plain text serial

```bash
curl -X POST https://<your-worker>.workers.dev/scan \
  -F "image=@typenschild.jpg"
```

Response body is only the serial, e.g. `SS-24.12345-884P`  
HTTP `404` with empty body if nothing was found.

Only complete values matching this pattern are accepted:

```regex
^[(A-Za-z0-9\s)\-+]{2,}-[0-9]{2,3}\.[0-9]{4,6}-[0-9]{2,5}P?$
```

### JSON mode

```bash
curl -X POST "https://<your-worker>.workers.dev/scan?format=json" \
  -H "Accept: application/json" \
  -F "image=@typenschild.jpg"
```

```json
{
  "serial": "SS-24.12345-884P",
  "confidence": "high",
  "found": true,
  "rawText": "...",
  "model": "@cf/moondream/moondream3.1-9B-A2B",
  "durationMs": 842
}
```

### Text-only test (no vision)

```bash
curl -X POST https://<your-worker>.workers.dev/scan \
  -H "Content-Type: application/json" \
  -d '{"text":"Typenschild Seeschiff\\nSeriennummer: SS-24.12345-884P"}'
```

Accepted image inputs:

1. `multipart/form-data` field `image` / `file` / `photo`
2. Raw body with `Content-Type: image/*`
3. JSON `{ "image": "data:image/jpeg;base64,..." }`

## Embed in another website

```html
<input id="serial" />
<script
  src="https://YOUR_WORKER.workers.dev/embed.js"
  data-endpoint="https://YOUR_WORKER.workers.dev"
  data-auto="true"
  data-fill="#serial"
  data-button-label="Scan type label"
></script>
```

Programmatic API:

```html
<script src="https://YOUR_WORKER.workers.dev/embed.js"></script>
<script>
  const scanner = OCRScan.create({
    endpoint: "https://YOUR_WORKER.workers.dev",
    onResult(serial) {
      console.log(serial); // plain text serial
    },
  });
  document.querySelector("#btn").onclick = () => scanner.open();
</script>
```

Events: `ocr-scan:result` CustomEvent with `{ detail: { serial } }`.

## Configuration (`wrangler.toml`)

- `ALLOWED_ORIGINS` — `*` (default) or comma-separated origins for CORS
- `API_KEY` (optional secret) — require `X-OCR-Key` / `Bearer` on `/scan`

```bash
npx wrangler secret put API_KEY
```

Workers AI must be enabled on your Cloudflare account (paid usage for vision models).

## Project layout

```
src/index.ts      Worker entry (routes, OCR, CORS)
src/extract.ts    Serial parsing for Typenschild / Seeschiff text
src/cors.ts       CORS helpers
public/embed.js   Embeddable scanner widget
public/demo.html  Demo UI
```

## Notes

- Best results: sharp photo, even lighting, label filling most of the frame.
- Max image size: 4 MB.
- Default response is **plain text** so hosts can drop the value straight into a form field.
- The Worker is integration-friendly (CORS + embed script); it does not need to be same-origin with the host app.
