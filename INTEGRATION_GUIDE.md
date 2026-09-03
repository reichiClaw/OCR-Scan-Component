# OCR Scan Component — Deployment and Website Integration Manual

This manual explains how to deploy the Cloudflare Worker and integrate serial-number scanning into an existing website or web application.

The scanner:

1. Receives a photo of a type label, Typenschild, or Seeschiff plate.
2. Uses Cloudflare Workers AI to read the label.
3. returns a serial number only when it matches:

   ```regex
   ^[(A-Za-z0-9\s)\-+]{2,}-[0-9]{2,3}\.[0-9]{4,6}-[0-9]{2,5}P?$
   ```

4. Returns the accepted serial number as plain text, or as JSON when requested.

## 1. Prerequisites

You need:

- A Cloudflare account.
- Workers AI enabled for that account.
- Node.js 20 or newer.
- npm.
- A website served over HTTPS if visitors will use a camera.

Camera access (`getUserMedia`) normally works only on HTTPS pages or `localhost`.

## 2. Deploy the Worker

Clone the repository and install its dependencies:

```bash
git clone https://github.com/reichiClaw/OCR-Scan-Component.git
cd OCR-Scan-Component
npm install
```

Authenticate Wrangler:

```bash
npx wrangler login
```

Check the project before deployment:

```bash
npm test
npm run check
npx wrangler deploy --dry-run
```

Deploy:

```bash
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://ocr-scan-component.<your-subdomain>.workers.dev
```

Save this URL. It is called `WORKER_URL` throughout this guide.

Check the deployment:

```bash
curl https://ocr-scan-component.<your-subdomain>.workers.dev/health
```

The response should contain `"ok": true`.

Open the included interactive demo:

```text
https://ocr-scan-component.<your-subdomain>.workers.dev/demo
```

## 3. Recommended production configuration

### Restrict browser origins

`wrangler.toml` initially contains:

```toml
[vars]
ALLOWED_ORIGINS = "*"
```

For production, replace `*` with the exact sites that may call the scanner:

```toml
[vars]
ALLOWED_ORIGINS = "https://www.example.com,https://app.example.com"
```

Origins contain the protocol and hostname, and optionally a non-default port. They do not contain a path or trailing slash.

Correct:

```text
https://app.example.com
```

Incorrect:

```text
app.example.com/scanner/
```

Deploy again after changing `wrangler.toml`:

```bash
npm run deploy
```

### Protect server-to-server API calls

Create a Worker secret:

```bash
npx wrangler secret put API_KEY
```

The command asks for the secret value without storing it in the repository. Requests must then include one of:

```http
X-OCR-Key: your-secret
```

or:

```http
Authorization: Bearer your-secret
```

Do not place a permanent secret in public HTML or browser JavaScript. Any visitor can inspect it. For a public browser integration, use origin restrictions and Cloudflare rate limiting, or call the Worker through your own authenticated backend.

## 4. Integration option A: drop-in scanner button

This is the quickest integration. It adds a button, opens the camera/upload dialog, and writes the result into an existing input.

```html
<form>
  <label for="serial-number">Serial number</label>
  <input id="serial-number" name="serialNumber" type="text" />
</form>

<script
  src="https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/embed.js"
  data-endpoint="https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev"
  data-auto="true"
  data-fill="#serial-number"
  data-button-label="Scan serial number"
></script>
```

Configuration attributes:

| Attribute | Required | Description |
| --- | --- | --- |
| `src` | Yes | URL of the Worker-hosted `embed.js` file |
| `data-endpoint` | Yes | Worker base URL without `/scan` |
| `data-auto` | No | Set to `true` to create a launcher button automatically |
| `data-fill` | No | CSS selector of the input that receives the serial |
| `data-button-label` | No | Text shown on the launcher button |
| `data-target` | No | CSS selector of the element where the button is inserted |

Example with a dedicated button container:

```html
<input id="machine-serial" name="machineSerial" />
<div id="serial-scanner-button"></div>

<script
  src="https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/embed.js"
  data-endpoint="https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev"
  data-auto="true"
  data-target="#serial-scanner-button"
  data-fill="#machine-serial"
></script>
```

When a serial is found, the widget updates the input and dispatches standard `input` and `change` events. This allows most form libraries to detect the new value.

## 5. Integration option B: programmatic browser API

Use this option when the host application controls its own button or needs custom behavior.

```html
<button type="button" id="scan-serial">Scan label</button>
<output id="scan-result"></output>
<p id="scan-error" role="alert"></p>

<script src="https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/embed.js"></script>
<script>
  const result = document.querySelector("#scan-result");
  const error = document.querySelector("#scan-error");

  const scanner = OCRScan.create({
    endpoint: "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev",
    title: "Scan type label",

    onResult(serial) {
      result.textContent = serial;
      error.textContent = "";
    },

    onError(cause) {
      error.textContent = cause.message || String(cause);
    },

    onClose() {
      console.log("Scanner closed");
    },
  });

  document.querySelector("#scan-serial").addEventListener("click", () => {
    scanner.open();
  });
</script>
```

The object returned by `OCRScan.create()` provides:

| Method | Description |
| --- | --- |
| `open()` | Opens the camera/upload dialog |
| `close()` | Closes the dialog and stops the camera |
| `scanBlob(blob)` | Uploads a browser `Blob` or `File` and resolves to the serial string |
| `scanFile(file)` | Scans a selected file and updates the widget UI |

### Listen for the global result event

An automatically mounted widget dispatches `ocr-scan:result`:

```js
window.addEventListener("ocr-scan:result", (event) => {
  const serial = event.detail.serial;
  console.log("Scanned serial:", serial);
});
```

## 6. Integration option C: call the REST API directly

### Browser file upload

```html
<input id="label-photo" type="file" accept="image/*" capture="environment" />

<script>
  document.querySelector("#label-photo").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append("image", file);

    const response = await fetch(
      "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan",
      {
        method: "POST",
        headers: {
          Accept: "text/plain",
        },
        body: form,
      },
    );

    if (response.status === 404) {
      throw new Error("No matching serial number was found");
    }

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const serial = (await response.text()).trim();
    console.log(serial);
  });
</script>
```

Do not manually set the `Content-Type` header for `FormData`. The browser adds the required multipart boundary.

### Command-line upload

```bash
curl \
  --request POST \
  --form "image=@/path/to/type-label.jpg" \
  --header "Accept: text/plain" \
  https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan
```

### Raw image request

```bash
curl \
  --request POST \
  --header "Content-Type: image/jpeg" \
  --header "Accept: text/plain" \
  --data-binary "@/path/to/type-label.jpg" \
  https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan
```

### Base64 JSON request

```js
async function scanDataUrl(dataUrl) {
  const response = await fetch(
    "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
      },
      body: JSON.stringify({ image: dataUrl }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.text()).trim();
}
```

The JSON property may be named `image`, `imageBase64`, or `dataUrl`.

## 7. JSON response mode

Use JSON mode when the application needs OCR details or confidence information:

```js
const form = new FormData();
form.append("image", file);

const response = await fetch(
  "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan?format=json",
  {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: form,
  },
);

const result = await response.json();
```

Successful response:

```json
{
  "serial": "SS-24.12345-884P",
  "confidence": "high",
  "found": true,
  "rawText": "Text read from the label",
  "matchedBy": "the validation expression",
  "model": "@cf/moondream/moondream3.1-9B-A2B",
  "durationMs": 842
}
```

The Worker responds with HTTP `404` and `"found": false` when OCR completes but no matching serial is present.

## 8. React example

Load the embed script once, then create the scanner after it is available:

```tsx
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    OCRScan: {
      create(options: {
        endpoint: string;
        onResult(serial: string): void;
        onError(error: Error): void;
      }): {
        open(): void;
        close(): void;
      };
    };
  }
}

export function SerialScanner() {
  const [serial, setSerial] = useState("");
  const [error, setError] = useState("");
  const scanner = useRef<ReturnType<typeof window.OCRScan.create> | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/embed.js";
    script.async = true;

    script.onload = () => {
      scanner.current = window.OCRScan.create({
        endpoint:
          "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev",
        onResult(value) {
          setSerial(value);
          setError("");
        },
        onError(cause) {
          setError(cause.message);
        },
      });
    };

    document.head.appendChild(script);

    return () => {
      scanner.current?.close();
      script.remove();
    };
  }, []);

  return (
    <div>
      <label>
        Serial number
        <input value={serial} readOnly />
      </label>
      <button type="button" onClick={() => scanner.current?.open()}>
        Scan serial
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

If the application has a strict Content Security Policy, permit the Worker hostname in `script-src` and `connect-src`.

Example:

```http
Content-Security-Policy:
  script-src 'self' https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev;
  connect-src 'self' https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev;
```

The inline examples in this guide also require an appropriate nonce or an external JavaScript file when `unsafe-inline` is disabled.

## 9. Backend integration

Calling the scanner from a backend keeps an API key private.

Node.js example:

```js
import { readFile } from "node:fs/promises";

const bytes = await readFile("./type-label.jpg");

const response = await fetch(
  "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan",
  {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      Accept: "text/plain",
      "X-OCR-Key": process.env.OCR_API_KEY,
    },
    body: bytes,
  },
);

if (!response.ok) {
  throw new Error(`OCR request failed: ${response.status} ${await response.text()}`);
}

const serial = (await response.text()).trim();
```

Keep `OCR_API_KEY` in the hosting platform's secret manager. Never commit it.

## 10. Endpoint reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Service information |
| `GET` | `/health` | Health and endpoint information |
| `GET` | `/demo` | Interactive scanner demonstration |
| `GET` | `/embed.js` | Embeddable browser widget |
| `POST` | `/scan` | Scan image and return plain text |
| `POST` | `/api/scan` | Alias of `/scan` |
| `POST` | `/scan?format=json` | Scan image and return structured JSON |
| `OPTIONS` | Any API path | CORS preflight |

Accepted image formats are determined by the vision model and browser, with JPEG and PNG recommended. The Worker rejects images larger than 4 MB.

## 11. Status codes

| Status | Meaning |
| --- | --- |
| `200` | A matching serial was found |
| `204` | Successful CORS preflight |
| `400` | Missing, invalid, or oversized image |
| `401` | Missing or incorrect API key |
| `404` | OCR ran, but no serial matched the required pattern |
| `500` | Workers AI or Worker processing failed |

For plain-text mode, a `404` response has an empty response body. Use the status code to distinguish it from success.

## 12. Serial-number validation behavior

The complete extracted candidate must match:

```regex
^[(A-Za-z0-9\s)\-+]{2,}-[0-9]{2,3}\.[0-9]{4,6}-[0-9]{2,5}P?$
```

Examples:

| Value | Accepted |
| --- | --- |
| `AB-12.1234-12` | Yes |
| `SS-24.12345-884P` | Yes |
| `AB (12)+X-123.123456-12345` | Yes |
| `AB-1.1234-12` | No: first numeric block is too short |
| `AB-12.123-12` | No: middle numeric block is too short |
| `AB-12.1234-1` | No: final numeric block is too short |
| `AB-12.1234-12p` | No: optional suffix must be uppercase `P` |
| `SS-2024-88421` | No: does not follow the dotted format |

The expression supplied for this project permits letters, digits, whitespace, parentheses, hyphens, and plus signs in its first section.

## 13. Image capture recommendations

For better OCR accuracy:

- Fill most of the camera frame with the plate.
- Keep the camera parallel to the plate.
- Avoid reflections on metallic labels.
- Use bright, even lighting.
- Keep the image sharp and in focus.
- Remove dirt when safe.
- Prefer the original image over a messaging-app-compressed copy.
- Retake the photo when the serial is visually ambiguous.

The validation pattern prevents unrelated OCR text from being returned, but it cannot correct a digit that the vision model reads incorrectly. For operationally important serials, show the extracted value to the user for confirmation.

## 14. Security and operations checklist

Before production use:

- Set `ALLOWED_ORIGINS` to known browser origins.
- Keep API keys in backend secret storage.
- Do not embed permanent secrets in frontend code.
- Configure Cloudflare rate limiting or application-level quotas.
- Add authentication in the host application where appropriate.
- Avoid logging full label images unless required.
- Define a retention policy if images or OCR text are stored elsewhere.
- Inform users that an image is sent to Cloudflare Workers AI.
- Confirm applicable privacy and data-processing requirements.
- Monitor Workers AI usage and billing.
- Test with representative labels, lighting, devices, and browsers.

The current Worker processes requests in memory and does not intentionally persist uploaded images.

## 15. Troubleshooting

### Camera does not open

Check:

- The host page is HTTPS or `localhost`.
- The browser has camera permission.
- The page is not inside an iframe that blocks camera access.
- If inside an iframe, the iframe has `allow="camera"`.
- The site's Permissions Policy permits camera access.

Example iframe:

```html
<iframe src="https://app.example.com/scanner" allow="camera"></iframe>
```

Example response header:

```http
Permissions-Policy: camera=(self)
```

Users can still select an existing photo when camera access is unavailable.

### Browser reports a CORS error

Verify that:

- `ALLOWED_ORIGINS` contains the exact host-page origin.
- The Worker was redeployed after configuration changes.
- The endpoint uses `https://`.
- A reverse proxy is not removing CORS headers.

### Every scan returns 404

This means no candidate passed the strict format check. Inspect JSON mode's `rawText`:

```bash
curl \
  --form "image=@type-label.jpg" \
  --header "Accept: application/json" \
  "https://ocr-scan-component.YOUR_SUBDOMAIN.workers.dev/scan?format=json"
```

Compare the OCR text with the required regex. Improve the photo if OCR confused similar characters such as `0/O`, `1/I`, or `5/S`.

### Worker returns 401

An `API_KEY` secret is configured. Include `X-OCR-Key` or `Authorization: Bearer ...`, or remove the secret from the Worker configuration if authentication is not required.

### Worker returns 500

Check live Worker logs:

```bash
npx wrangler tail
```

Confirm Workers AI is enabled and available for the account. Also verify current model availability in Cloudflare's Workers AI documentation.

### Upload is rejected as too large

Resize or compress the image below 4 MB. A high-quality JPEG around 1280–2000 pixels on its longest edge is usually sufficient for a readable label.

## 16. Local development

Start Wrangler:

```bash
npm run dev
```

For Workers AI behavior that requires Cloudflare infrastructure, use:

```bash
npx wrangler dev --remote
```

Run parser tests:

```bash
npm test
```

Run TypeScript checking:

```bash
npm run check
```

Create a production-equivalent bundle without deploying:

```bash
npx wrangler deploy --dry-run
```

## 17. Updating the serial scheme

The validation expression is defined in:

```text
src/extract.ts
```

Update `SERIAL_NUMBER_SOURCE`, then update the examples and tests in:

```text
src/extract.test.ts
```

Verify all changes before deployment:

```bash
npm test
npm run check
npx wrangler deploy --dry-run
```

