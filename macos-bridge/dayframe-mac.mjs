#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PORT = 43822;
const TOKEN_FILE = path.join(os.homedir(), ".dayframe-bridge-token");
const ANDROID_SYNC_DIR = path.join(os.homedir(), "Pictures", "Dayframe-Android");

const PRIVATE_APP_BLOCKLIST = new Set([
  "1Password",
  "Keychain Access",
  "Bitwarden",
  "Passwords",
  "LastPass",
]);

function loadOrCreatePairingToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // Generate fresh token below
  }
  const fresh = crypto.randomBytes(24).toString("hex");
  try {
    fs.writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 });
  } catch {
    // Non-fatal if home dir is read-only
  }
  return fresh;
}

const PAIRING_TOKEN = loadOrCreatePairingToken();

function verifyBearer(req) {
  const header = String(req.headers["authorization"] || "");
  const expected = `Bearer ${PAIRING_TOKEN}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (
    origin &&
    (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
      /^https:\/\/[a-z0-9-]+\.cursor\.(app|run|sh)$/.test(origin) ||
      /^https:\/\/([a-z0-9-]+\.)?cursor\.com$/.test(origin))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function sendJson(req, res, statusCode, payload) {
  applyCorsHeaders(req, res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function runStaticJxa(scriptName, stdinObject = {}) {
  const scriptPath = path.join(__dirname, "jxa", scriptName);
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({
        ok: false,
        error: "Native Calendar/Mail JXA requires macOS (darwin).",
      });
      return;
    }
    const child = execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", scriptPath],
      { timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error: (stderr || err.message || "osascript failed").trim(),
          });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ ok: false, error: "Unexpected output from macOS bridge." });
        }
      }
    );
    if (child.stdin) {
      child.stdin.write(JSON.stringify(stdinObject));
      child.stdin.end();
    }
  });
}

function captureMacScreenSilent() {
  return new Promise(async (resolve) => {
    if (process.platform !== "darwin") {
      resolve({
        ok: false,
        error: "Silent native screencapture requires macOS.",
      });
      return;
    }

    const frontInfo = await runStaticJxa("frontmost-app.jxa");
    const appName = frontInfo.appName || "macOS";
    const windowTitle = frontInfo.windowTitle || "";

    if (PRIVATE_APP_BLOCKLIST.has(appName)) {
      resolve({
        ok: true,
        skippedPrivateApp: true,
        appName,
        windowTitle,
      });
      return;
    }

    const tempShotPath = path.join(
      os.tmpdir(),
      `dayframe-shot-${crypto.randomUUID()}.jpg`
    );

    execFile(
      "/usr/sbin/screencapture",
      ["-x", "-t", "jpg", tempShotPath],
      { timeout: 10000 },
      (err) => {
        if (err || !fs.existsSync(tempShotPath)) {
          resolve({
            ok: false,
            error:
              "macOS Screen Recording permission needed. Allow Terminal / Node in System Settings → Privacy & Security → Screen Recording.",
          });
          return;
        }
        try {
          const bytes = fs.readFileSync(tempShotPath);
          fs.unlinkSync(tempShotPath);
          const imageDataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
          resolve({
            ok: true,
            skippedPrivateApp: false,
            appName,
            windowTitle,
            imageDataUrl,
          });
        } catch {
          try {
            if (fs.existsSync(tempShotPath)) fs.unlinkSync(tempShotPath);
          } catch {
            // ignore cleanup error
          }
          resolve({ ok: false, error: "Failed reading captured frame." });
        }
      }
    );
  });
}

function listAndroidSyncedScreenshots() {
  try {
    fs.mkdirSync(ANDROID_SYNC_DIR, { recursive: true });
    const entries = fs.readdirSync(ANDROID_SYNC_DIR);
    const images = [];
    for (const name of entries.slice(0, 25)) {
      if (!/^[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
      const fullPath = path.resolve(ANDROID_SYNC_DIR, name);
      if (!fullPath.startsWith(path.resolve(ANDROID_SYNC_DIR) + path.sep)) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      const ext = path.extname(name).toLowerCase().replace(".", "");
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const dataUrl = `data:${mime};base64,${fs.readFileSync(fullPath).toString("base64")}`;
      images.push({
        filename: name,
        capturedAtIso: stat.mtime.toISOString(),
        imageDataUrl: dataUrl,
      });
    }
    return { ok: true, folder: ANDROID_SYNC_DIR, screenshots: images };
  } catch {
    return { ok: true, folder: ANDROID_SYNC_DIR, screenshots: [] };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    applyCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${BRIDGE_PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(req, res, 200, {
      ok: true,
      service: "dayframe-macos-bridge",
      platform: process.platform,
      requiresPairing: true,
    });
    return;
  }

  if (!verifyBearer(req)) {
    sendJson(req, res, 401, {
      ok: false,
      error: "Invalid or missing Mac Bridge pairing token.",
    });
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(req, res, 200, {
        ok: true,
        platform: process.platform,
        isMac: process.platform === "darwin",
        androidSyncFolder: ANDROID_SYNC_DIR,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/calendar/scan") {
      const body = await readJsonBody(req);
      const startMs = Number(body.startMs) || Date.now();
      const endMs =
        Number(body.endMs) || startMs + 7 * 24 * 60 * 60 * 1000;
      const result = await runStaticJxa("read-calendars.jxa", {
        startMs,
        endMs,
      });
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/calendar/create") {
      const body = await readJsonBody(req);
      const title = String(body.title || "Scheduled Block").slice(0, 200);
      const startMs = Number(body.startMs);
      const endMs = Number(body.endMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        sendJson(req, res, 400, { ok: false, error: "Invalid start/end timestamps." });
        return;
      }
      const result = await runStaticJxa("write-event.jxa", {
        title,
        startMs,
        endMs,
        notes: body.notes ? String(body.notes).slice(0, 1000) : "",
        location: body.location ? String(body.location).slice(0, 240) : "",
        calendarId: body.calendarId ? String(body.calendarId).slice(0, 120) : "",
      });
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mail/scan") {
      const body = await readJsonBody(req);
      const limit = Math.min(20, Math.max(1, Number(body.limit) || 10));
      const result = await runStaticJxa("read-mail.jxa", { limit });
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/capture/screen") {
      const result = await captureMacScreenSilent();
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/android/queue") {
      sendJson(req, res, 200, listAndroidSyncedScreenshots());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/valen/decisions") {
      const body = await readJsonBody(req);
      const allowedPorts = new Set([43823, 8080, 8000, 30000]);
      const requestedPort = Number(body.port);
      const targetPort = allowedPorts.has(requestedPort) ? requestedPort : 43823;
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const upstream = await fetch(`http://127.0.0.1:${targetPort}/v1/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        clearTimeout(timer);
        const text = await upstream.text();
        let parsed = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text.slice(0, 300) };
        }
        sendJson(req, res, upstream.ok ? 200 : 502, {
          ok: upstream.ok,
          status: upstream.status,
          data: parsed,
        });
      } catch (e) {
        clearTimeout(timer);
        sendJson(req, res, 200, {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : `Valen GGUF server not reachable on 127.0.0.1:${targetPort}`,
        });
      }
      return;
    }

    sendJson(req, res, 404, { ok: false, error: "Route not found." });
  } catch (err) {
    sendJson(req, res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : "Bridge error",
    });
  }
});

server.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log("\n========================================================");
  console.log("  Dayframe Native macOS Bridge running on 127.0.0.1:43822");
  console.log("========================================================");
  console.log(`  Pairing Token: ${PAIRING_TOKEN}`);
  console.log(`  Android Sync Folder: ${ANDROID_SYNC_DIR}`);
  console.log(
    "  Capabilities: macOS Calendar.app (EventKit), Mail.app, Silent screencapture\n"
  );

  if (process.argv.includes("--open") && process.platform === "darwin") {
    const uiPort = process.env.DAYFRAME_UI_PORT || "3000";
    const targetUrl = `http://127.0.0.1:${uiPort}/#pair=${PAIRING_TOKEN}`;
    execFile("/usr/bin/open", [targetUrl], () => {});
  }
});
