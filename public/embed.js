/**
 * OCR Scan Component — drop-in widget for other websites / web apps.
 *
 * Usage:
 *   <script src="https://YOUR_WORKER.workers.dev/embed.js"
 *           data-endpoint="https://YOUR_WORKER.workers.dev"
 *           data-auto="true"></script>
 *
 * Or programmatically:
 *   const scanner = OCRScan.create({ endpoint: "...", onResult(serial) { ... } });
 *   scanner.open();
 */
(function (global) {
  "use strict";

  var STYLE_ID = "ocr-scan-embed-styles";
  var DEFAULT_ENDPOINT = "";

  function currentScript() {
    return document.currentScript || (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1] || null;
    })();
  }

  function scriptAttr(name, fallback) {
    var el = currentScript();
    if (!el) return fallback;
    var v = el.getAttribute(name);
    return v == null || v === "" ? fallback : v;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent = [
      ".ocr-scan-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(8,12,18,.72);display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,sans-serif}",
      ".ocr-scan-panel{width:min(440px,92vw);background:#0f1720;color:#e8eef6;border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45)}",
      ".ocr-scan-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}",
      ".ocr-scan-header h2{margin:0;font-size:15px;font-weight:600;letter-spacing:.02em}",
      ".ocr-scan-close{appearance:none;border:0;background:transparent;color:#9fb0c3;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}",
      ".ocr-scan-body{padding:16px}",
      ".ocr-scan-video-wrap{position:relative;aspect-ratio:4/3;background:#000;border-radius:12px;overflow:hidden}",
      ".ocr-scan-video-wrap video,.ocr-scan-video-wrap img{width:100%;height:100%;object-fit:cover;display:block}",
      ".ocr-scan-frame{pointer-events:none;position:absolute;inset:12%;border:2px solid rgba(90,200,250,.85);border-radius:10px;box-shadow:0 0 0 999px rgba(0,0,0,.28)}",
      ".ocr-scan-hint{margin:12px 0 0;font-size:13px;color:#9fb0c3;line-height:1.4}",
      ".ocr-scan-actions{display:flex;gap:8px;margin-top:14px}",
      ".ocr-scan-actions button{flex:1;border:0;border-radius:10px;padding:12px 14px;font-size:14px;font-weight:600;cursor:pointer}",
      ".ocr-scan-primary{background:#3aa0ff;color:#041018}",
      ".ocr-scan-secondary{background:rgba(255,255,255,.08);color:#e8eef6}",
      ".ocr-scan-status{min-height:1.2em;margin-top:10px;font-size:13px;color:#7dd3fc}",
      ".ocr-scan-result{margin-top:12px;padding:12px;border-radius:10px;background:rgba(61,214,140,.12);color:#b7f5d0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;word-break:break-all}",
      ".ocr-scan-error{color:#ffb4b4}",
      ".ocr-scan-launcher{appearance:none;border:0;border-radius:999px;padding:12px 18px;background:#0f1720;color:#e8eef6;font:600 14px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2)}"
    ].join("");
    document.head.appendChild(css);
  }

  function create(options) {
    options = options || {};
    var endpoint = (options.endpoint || DEFAULT_ENDPOINT || scriptAttr("data-endpoint", "")).replace(/\/+$/, "");
    var apiKey = options.apiKey || scriptAttr("data-api-key", "");
    var title = options.title || "Scan type label";
    var onResult = typeof options.onResult === "function" ? options.onResult : null;
    var onError = typeof options.onError === "function" ? options.onError : null;
    var onClose = typeof options.onClose === "function" ? options.onClose : null;

    var overlay = null;
    var stream = null;
    var video = null;
    var statusEl = null;
    var resultEl = null;
    var busy = false;

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.className = "ocr-scan-status" + (isError ? " ocr-scan-error" : "");
    }

    function stopCamera() {
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
    }

    function close() {
      stopCamera();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      if (onClose) onClose();
    }

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not available in this browser");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      video.srcObject = stream;
      await video.play();
    }

    function captureBlob() {
      var canvas = document.createElement("canvas");
      var w = video.videoWidth || 1280;
      var h = video.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error("Could not capture frame"));
          else resolve(blob);
        }, "image/jpeg", 0.92);
      });
    }

    async function scanBlob(blob) {
      if (!endpoint) throw new Error("Missing Worker endpoint (data-endpoint)");
      var form = new FormData();
      form.append("image", blob, "label.jpg");
      var headers = { Accept: "text/plain" };
      if (apiKey) headers["X-OCR-Key"] = apiKey;
      var res = await fetch(endpoint + "/scan", {
        method: "POST",
        body: form,
        headers: headers,
      });
      var text = (await res.text()).trim();
      if (!res.ok) {
        throw new Error(text || ("Scan failed (" + res.status + ")"));
      }
      if (!text) throw new Error("No serial number found on the label");
      return text;
    }

    async function captureAndScan() {
      if (busy) return;
      busy = true;
      setStatus("Reading type label…");
      resultEl.style.display = "none";
      try {
        var blob = await captureBlob();
        var serial = await scanBlob(blob);
        resultEl.style.display = "block";
        resultEl.textContent = serial;
        setStatus("Serial number extracted");
        if (onResult) onResult(serial);
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        setStatus(msg, true);
        if (onError) onError(err);
      } finally {
        busy = false;
      }
    }

    async function pickFile(file) {
      if (!file || busy) return;
      busy = true;
      setStatus("Reading uploaded label…");
      resultEl.style.display = "none";
      try {
        var serial = await scanBlob(file);
        resultEl.style.display = "block";
        resultEl.textContent = serial;
        setStatus("Serial number extracted");
        if (onResult) onResult(serial);
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        setStatus(msg, true);
        if (onError) onError(err);
      } finally {
        busy = false;
      }
    }

    function open() {
      injectStyles();
      if (overlay) return;

      overlay = document.createElement("div");
      overlay.className = "ocr-scan-overlay";
      overlay.innerHTML =
        '<div class="ocr-scan-panel" role="dialog" aria-modal="true">' +
        '<div class="ocr-scan-header"><h2></h2><button type="button" class="ocr-scan-close" aria-label="Close">&times;</button></div>' +
        '<div class="ocr-scan-body">' +
        '<div class="ocr-scan-video-wrap"><video playsinline muted autoplay></video><div class="ocr-scan-frame"></div></div>' +
        '<p class="ocr-scan-hint">Align the Typenschild / Seeschiff type label inside the frame. Good light helps OCR.</p>' +
        '<div class="ocr-scan-actions">' +
        '<button type="button" class="ocr-scan-primary" data-action="capture">Scan serial</button>' +
        '<button type="button" class="ocr-scan-secondary" data-action="upload">Upload photo</button>' +
        "</div>" +
        '<div class="ocr-scan-status"></div>' +
        '<div class="ocr-scan-result" style="display:none"></div>' +
        '<input type="file" accept="image/*" capture="environment" hidden />' +
        "</div></div>";

      overlay.querySelector("h2").textContent = title;
      video = overlay.querySelector("video");
      statusEl = overlay.querySelector(".ocr-scan-status");
      resultEl = overlay.querySelector(".ocr-scan-result");
      var fileInput = overlay.querySelector('input[type="file"]');

      overlay.querySelector(".ocr-scan-close").addEventListener("click", close);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
      overlay.querySelector('[data-action="capture"]').addEventListener("click", captureAndScan);
      overlay.querySelector('[data-action="upload"]').addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) pickFile(fileInput.files[0]);
        fileInput.value = "";
      });

      document.body.appendChild(overlay);
      startCamera().catch(function (err) {
        setStatus(
          (err && err.message ? err.message : "Camera blocked") +
            " — you can still upload a photo.",
          true,
        );
      });
    }

    return {
      open: open,
      close: close,
      scanBlob: scanBlob,
      scanFile: pickFile,
    };
  }

  function mountLauncher(targetSelector) {
    injectStyles();
    var host =
      (targetSelector && document.querySelector(targetSelector)) ||
      document.body;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ocr-scan-launcher";
    btn.textContent = scriptAttr("data-button-label", "Scan serial number");
    var scanner = create({
      onResult: function (serial) {
        global.dispatchEvent(
          new CustomEvent("ocr-scan:result", { detail: { serial: serial } }),
        );
        var fill = scriptAttr("data-fill", "");
        if (fill) {
          var input = document.querySelector(fill);
          if (input) {
            input.value = serial;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      },
    });
    btn.addEventListener("click", function () {
      scanner.open();
    });
    host.appendChild(btn);
    return scanner;
  }

  var api = { create: create, mountLauncher: mountLauncher };
  global.OCRScan = api;

  // Auto-mount when data-auto="true"
  if (scriptAttr("data-auto", "false") === "true") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mountLauncher(scriptAttr("data-target", null));
      });
    } else {
      mountLauncher(scriptAttr("data-target", null));
    }
  }
})(typeof window !== "undefined" ? window : this);
