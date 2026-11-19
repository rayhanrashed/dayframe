#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BRIDGE_PORT = 43822;
const DAYFRAME_HOME = path.join(os.homedir(), ".dayframe");
const TOKEN_FILE = path.join(os.homedir(), ".dayframe-bridge-token");
const QUEUE_DIR = path.join(DAYFRAME_HOME, "capture-queue");
const MODELS_DIR = path.join(DAYFRAME_HOME, "models");
const COLLECTOR_CONFIG_FILE = path.join(DAYFRAME_HOME, "collector-config.json");
const ANDROID_SYNC_DIR = path.join(os.homedir(), "Pictures", "Dayframe-Android");

const PRIVATE_APP_BLOCKLIST = new Set([
  "1Password",
  "Keychain Access",
  "Bitwarden",
  "Passwords",
  "LastPass",
  "ScreenSaverEngine",
  "loginwindow",
]);

fs.mkdirSync(QUEUE_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Pairing Token & Strict Loopback Security
// ---------------------------------------------------------------------------
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
    // Non-fatal
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
      if (raw.length > 4_000_000) {
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

function detectHostTerminalApp() {
  const term = String(process.env.TERM_PROGRAM || "");
  if (process.env.CURSOR_TRACE_ID || /cursor/i.test(term)) return "Cursor";
  if (term === "vscode") return "Cursor / VS Code";
  if (term === "iTerm.app") return "iTerm";
  if (term === "WarpTerminal") return "Warp";
  if (term === "Apple_Terminal") return "Terminal";
  return term || "Terminal (or the app where you ran ./dayframe)";
}

const BIN_DIR = path.join(DAYFRAME_HOME, "bin");
fs.mkdirSync(BIN_DIR, { recursive: true });

let cachedSwiftHelperPath = null;
let swiftCompileAttempted = false;

function ensureSwiftEventKitBinary() {
  if (process.platform !== "darwin") return null;
  if (cachedSwiftHelperPath && fs.existsSync(cachedSwiftHelperPath)) {
    return cachedSwiftHelperPath;
  }
  if (swiftCompileAttempted) return null;
  swiftCompileAttempted = true;

  const swiftSrc = path.join(__dirname, "swift", "dayframe-eventkit.swift");
  const plistPath = path.join(__dirname, "swift", "Info.plist");
  const outBin = path.join(BIN_DIR, "dayframe-eventkit");
  const stampFile = path.join(BIN_DIR, "dayframe-eventkit.mtime");

  if (!fs.existsSync("/usr/bin/swiftc") || !fs.existsSync(swiftSrc) || !fs.existsSync(plistPath)) {
    return null;
  }

  const srcMtime = String(Math.floor(fs.statSync(swiftSrc).mtimeMs));
  if (
    fs.existsSync(outBin) &&
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, "utf8").trim() === srcMtime
  ) {
    cachedSwiftHelperPath = outBin;
    return outBin;
  }

  return new Promise((resolve) => {
    execFile(
      "/usr/bin/swiftc",
      [
        swiftSrc,
        "-framework",
        "EventKit",
        "-framework",
        "Foundation",
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        plistPath,
        "-o",
        outBin,
      ],
      { timeout: 25000 },
      (err) => {
        if (err || !fs.existsSync(outBin)) {
          resolve(null);
          return;
        }
        execFile(
          "/usr/bin/codesign",
          ["-s", "-", "--force", "--identifier", "local.dayframe.eventkit-helper", outBin],
          { timeout: 5000 },
          () => {
            try {
              fs.writeFileSync(stampFile, srcMtime, "utf8");
            } catch {}
            cachedSwiftHelperPath = outBin;
            resolve(outBin);
          }
        );
      }
    );
  });
}

function runSwiftEventKit(binPath, stdinObject = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      binPath,
      [],
      { timeout: 22000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ ok: false, error: err.message });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ ok: false, error: "Invalid output from Swift EventKit helper." });
        }
      }
    );
    if (child.stdin) {
      child.stdin.write(JSON.stringify(stdinObject));
      child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Static JXA Runner (Calendar.app EventKit, Mail.app, Frontmost App, Notify)
// ---------------------------------------------------------------------------
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

async function runCalendarWaterfall(action, payload) {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      error: "macOS Calendar integration requires running ./dayframe on macOS.",
      calendars: [],
      events: [],
    };
  }

  // Tier 1: Native Swift EventKit helper (embeds NSCalendarsFullAccessUsageDescription in Mach-O Info.plist)
  const swiftBin = await ensureSwiftEventKitBinary();
  if (swiftBin) {
    const swiftRes = await runSwiftEventKit(swiftBin, { action, ...payload });
    if (swiftRes && swiftRes.ok) {
      return swiftRes;
    }
  }

  // Tier 2: Fixed JXA EventKit (checks authorizationStatusForEntityType(0) === 3 directly)
  const jxaScript = action === "create" ? "write-event.jxa" : "read-calendars.jxa";
  const jxaRes = await runStaticJxa(jxaScript, payload);
  if (jxaRes && jxaRes.ok) {
    return jxaRes;
  }

  // Tier 3: Calendar.app AppleEvents Automation fallback (works even if EventKit TCC is tied to another terminal app)
  const appFallbackRes = await runStaticJxa("calendar-app-fallback.jxa", {
    action,
    ...payload,
  });
  if (appFallbackRes && appFallbackRes.ok) {
    return appFallbackRes;
  }

  const hostApp = detectHostTerminalApp();
  return {
    ok: false,
    hostTerminalApp: hostApp,
    error: `macOS blocked Calendar access for "${hostApp}". Make sure "${hostApp}" (the exact app where you ran ./dayframe — e.g. Cursor vs Terminal.app) is enabled under System Settings → Privacy & Security → Calendars (and Automation → Calendar).`,
    calendars: [],
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Zero-AI-RAM Background Screen Capture Queue (~/.dayframe/capture-queue/)
// ---------------------------------------------------------------------------
let lastFrameHash = "";
let skippedDuplicateCount = 0;
let collectorTimer = null;
let collectorConfig = {
  enabled: false,
  intervalMinutes: 5,
};

try {
  if (fs.existsSync(COLLECTOR_CONFIG_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(COLLECTOR_CONFIG_FILE, "utf8"));
    collectorConfig = {
      enabled: Boolean(parsed.enabled),
      intervalMinutes: Math.max(1, Math.min(60, Number(parsed.intervalMinutes) || 5)),
    };
  }
} catch {
  // Use defaults
}

function saveCollectorConfig() {
  try {
    fs.writeFileSync(
      COLLECTOR_CONFIG_FILE,
      JSON.stringify(collectorConfig, null, 2),
      { mode: 0o600 }
    );
  } catch {
    // Non-fatal
  }
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
              "macOS Screen Recording permission needed. Allow Terminal / Node in System Settings -> Privacy & Security -> Screen Recording.",
          });
          return;
        }
        try {
          const bytes = fs.readFileSync(tempShotPath);
          fs.unlinkSync(tempShotPath);
          const hash = crypto.createHash("sha256").update(bytes).digest("hex");
          if (hash === lastFrameHash) {
            skippedDuplicateCount++;
            resolve({
              ok: true,
              skippedDuplicate: true,
              appName,
              windowTitle,
            });
            return;
          }
          lastFrameHash = hash;
          const imageDataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
          resolve({
            ok: true,
            skippedPrivateApp: false,
            skippedDuplicate: false,
            appName,
            windowTitle,
            imageDataUrl,
            bytes,
          });
        } catch {
          try {
            if (fs.existsSync(tempShotPath)) fs.unlinkSync(tempShotPath);
          } catch {
            // ignore cleanup
          }
          resolve({ ok: false, error: "Failed reading captured frame." });
        }
      }
    );
  });
}

async function captureAndEnqueueToDisk() {
  const shot = await captureMacScreenSilent();
  if (!shot.ok || shot.skippedPrivateApp || shot.skippedDuplicate || !shot.bytes) {
    return shot;
  }
  const id = `q-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const jpgPath = path.join(QUEUE_DIR, `${id}.jpg`);
  const metaPath = path.join(QUEUE_DIR, `${id}.json`);
  const capturedAtIso = new Date().toISOString();
  try {
    fs.writeFileSync(jpgPath, shot.bytes, { mode: 0o600 });
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        id,
        capturedAtIso,
        appName: shot.appName,
        windowTitle: shot.windowTitle,
      }),
      { mode: 0o600 }
    );
    // Cap disk queue at 120 pending screenshots (FIFO)
    const metas = fs
      .readdirSync(QUEUE_DIR)
      .filter((n) => n.endsWith(".json"))
      .sort();
    while (metas.length > 120) {
      const oldest = metas.shift();
      if (!oldest) break;
      const base = oldest.replace(/\.json$/, "");
      try {
        fs.unlinkSync(path.join(QUEUE_DIR, `${base}.json`));
        fs.unlinkSync(path.join(QUEUE_DIR, `${base}.jpg`));
      } catch {
        // ignore
      }
    }
    return {
      ok: true,
      queuedId: id,
      capturedAtIso,
      appName: shot.appName,
      windowTitle: shot.windowTitle,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Queue write failed" };
  }
}

function restartCollectorTimer() {
  if (collectorTimer) {
    clearInterval(collectorTimer);
    collectorTimer = null;
  }
  if (collectorConfig.enabled && process.platform === "darwin") {
    const ms = collectorConfig.intervalMinutes * 60 * 1000;
    collectorTimer = setInterval(() => {
      void captureAndEnqueueToDisk();
    }, ms);
  }
}

restartCollectorTimer();

function listDiskQueuedCaptures(includeImages = true) {
  try {
    const metas = fs
      .readdirSync(QUEUE_DIR)
      .filter((n) => /^q-[\w-]+\.json$/.test(n))
      .sort();
    const items = [];
    for (const metaFile of metas.slice(0, 60)) {
      const base = metaFile.replace(/\.json$/, "");
      const metaFull = path.join(QUEUE_DIR, metaFile);
      const jpgFull = path.join(QUEUE_DIR, `${base}.jpg`);
      if (!fs.existsSync(jpgFull)) continue;
      const meta = JSON.parse(fs.readFileSync(metaFull, "utf8"));
      items.push({
        id: meta.id || base,
        capturedAtIso: meta.capturedAtIso || new Date().toISOString(),
        appName: meta.appName || "macOS",
        windowTitle: meta.windowTitle || "",
        imageDataUrl: includeImages
          ? `data:image/jpeg;base64,${fs.readFileSync(jpgFull).toString("base64")}`
          : "",
      });
    }
    return {
      ok: true,
      totalQueued: metas.length,
      skippedDuplicates: skippedDuplicateCount,
      collectorEnabled: collectorConfig.enabled,
      intervalMinutes: collectorConfig.intervalMinutes,
      items,
    };
  } catch {
    return {
      ok: true,
      totalQueued: 0,
      skippedDuplicates: skippedDuplicateCount,
      collectorEnabled: collectorConfig.enabled,
      intervalMinutes: collectorConfig.intervalMinutes,
      items: [],
    };
  }
}

function acknowledgeQueuedCaptures(ids) {
  let removed = 0;
  for (const rawId of ids) {
    const safeId = String(rawId || "").trim();
    if (!/^q-[\w-]+$/.test(safeId)) continue;
    for (const ext of [".json", ".jpg"]) {
      const p = path.join(QUEUE_DIR, `${safeId}${ext}`);
      try {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
          if (ext === ".jpg") removed++;
        }
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// On-Demand Local Model Lifecycle Manager (0 MB Idle RAM Between Batches!)
// ---------------------------------------------------------------------------
let valenProc = null;
let ollamaProc = null;
let ollamaSpawnedByBridge = false;
let lastBatchCompletedIso = null;

function findExecutable(candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      // continue
    }
  }
  return null;
}

function resolveOllamaBinary() {
  return (
    findExecutable([
      "/opt/homebrew/bin/ollama",
      "/usr/local/bin/ollama",
      "/Applications/Ollama.app/Contents/Resources/ollama",
    ]) || "ollama"
  );
}

function resolveValenArtifacts(preferredGgufName) {
  const searchDirs = [MODELS_DIR, path.join(ROOT_DIR, "models"), ROOT_DIR];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const serverBin = findExecutable([
      path.join(dir, "serve"),
      path.join(dir, "valen-serve"),
      path.join(dir, "llama-server"),
      "/opt/homebrew/bin/llama-server",
    ]);
    const mmproj = files.find((f) => /vision.*\.gguf$/i.test(f) || /mmproj.*\.gguf$/i.test(f));
    const exactModel =
      preferredGgufName && files.includes(preferredGgufName)
        ? preferredGgufName
        : files.find(
            (f) =>
              f.toLowerCase().endsWith(".gguf") &&
              !/vision|mmproj/i.test(f) &&
              /valen/i.test(f)
          );
    if (serverBin && exactModel) {
      return {
        serverBin,
        modelPath: path.join(dir, exactModel),
        mmprojPath: mmproj ? path.join(dir, mmproj) : null,
      };
    }
  }
  return null;
}

async function checkHttpReachable(url, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok || r.status < 500;
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function queryOllamaLifecycle() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1400);
  try {
    const psRes = await fetch("http://127.0.0.1:11434/api/ps", {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!psRes.ok) {
      return { daemonRunning: false, loadedModels: [], residentRamMb: 0 };
    }
    const data = await psRes.json();
    const models = Array.isArray(data.models) ? data.models : [];
    let totalBytes = 0;
    const loadedModels = models.map((m) => {
      const sz = Number(m.size_vram || m.size || 0);
      totalBytes += sz;
      return String(m.name || m.model || "model");
    });
    return {
      daemonRunning: true,
      loadedModels,
      residentRamMb: Math.round(totalBytes / (1024 * 1024)),
    };
  } catch {
    clearTimeout(t);
    return { daemonRunning: false, loadedModels: [], residentRamMb: 0 };
  }
}

async function wakeValenOnDemand(port = 43823, ggufFile = "") {
  const safePort = [43823, 8080, 8000, 30000].includes(Number(port))
    ? Number(port)
    : 43823;

  if (await checkHttpReachable(`http://127.0.0.1:${safePort}/health`, 900)) {
    return { ok: true, running: true, spawned: false };
  }

  const artifacts = resolveValenArtifacts(ggufFile);
  if (!artifacts) {
    return {
      ok: false,
      running: false,
      reason:
        "No local Valen GGUF weights found in ~/.dayframe/models (staying in Standby; Gemma 4 will handle the batch directly).",
    };
  }

  const args = [
    "-m",
    artifacts.modelPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(safePort),
  ];
  if (artifacts.mmprojPath) {
    args.push("--mmproj", artifacts.mmprojPath);
  }

  valenProc = spawn(artifacts.serverBin, args, {
    stdio: "ignore",
    detached: false,
  });
  valenProc.on("exit", () => {
    valenProc = null;
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await checkHttpReachable(`http://127.0.0.1:${safePort}/health`, 800)) {
      return { ok: true, running: true, spawned: true };
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  return { ok: false, running: false, reason: "Timed out waking Valen server." };
}

async function stopValenImmediately() {
  if (!valenProc) {
    return { ok: true, stopped: false };
  }
  const proc = valenProc;
  valenProc = null;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve();
    }, 1500);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
  return { ok: true, stopped: true };
}

async function wakeOllamaOnDemand() {
  const existing = await queryOllamaLifecycle();
  if (existing.daemonRunning) {
    return { ok: true, running: true, spawnedByBridge: ollamaSpawnedByBridge };
  }

  const bin = resolveOllamaBinary();
  try {
    ollamaProc = spawn(bin, ["serve"], {
      stdio: "ignore",
      detached: false,
      env: {
        ...process.env,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_ORIGINS: "*",
        OLLAMA_NOUPDATE: "1",
        OLLAMA_KEEP_ALIVE: "90s",
      },
    });
    ollamaSpawnedByBridge = true;
    ollamaProc.on("exit", () => {
      ollamaProc = null;
      ollamaSpawnedByBridge = false;
    });
  } catch (err) {
    return {
      ok: false,
      running: false,
      error: err instanceof Error ? err.message : "Could not launch ollama serve.",
    };
  }

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await checkHttpReachable("http://127.0.0.1:11434/api/tags", 800)) {
      return { ok: true, running: true, spawnedByBridge: true };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return {
    ok: false,
    running: false,
    error: "Timed out waiting for local Ollama daemon on 127.0.0.1:11434.",
  };
}

async function unloadAndStopOllama(preferredModel = "") {
  const state = await queryOllamaLifecycle();
  const modelsToUnload = new Set(state.loadedModels);
  if (preferredModel) modelsToUnload.add(preferredModel);

  for (const modelName of modelsToUnload) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      });
      clearTimeout(t);
    } catch {
      // Ignore if already unloaded
    }
  }

  let daemonStopped = false;
  if (ollamaProc && ollamaSpawnedByBridge) {
    const proc = ollamaProc;
    ollamaProc = null;
    ollamaSpawnedByBridge = false;
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve();
      }, 1500);
      proc.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });
    daemonStopped = true;
  }

  lastBatchCompletedIso = new Date().toISOString();
  return { ok: true, unloadedModels: Array.from(modelsToUnload), daemonStopped };
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
      const mime =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
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

// ---------------------------------------------------------------------------
// HTTP Loopback Server (127.0.0.1:43822 ONLY — Zero Internet)
// ---------------------------------------------------------------------------
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
      offlineLoopbackOnly: true,
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
      const queueSummary = listDiskQueuedCaptures(false);
      const ollamaState = await queryOllamaLifecycle();
      sendJson(req, res, 200, {
        ok: true,
        platform: process.platform,
        isMac: process.platform === "darwin",
        offlineLoopbackOnly: true,
        androidSyncFolder: ANDROID_SYNC_DIR,
        queuedCaptureCount: queueSummary.totalQueued,
        collectorEnabled: collectorConfig.enabled,
        collectorIntervalMinutes: collectorConfig.intervalMinutes,
        modelsSleeping:
          valenProc === null && ollamaState.loadedModels.length === 0,
        residentAiRamMb: ollamaState.residentRamMb,
        lastBatchCompletedIso,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/models/lifecycle") {
      const port = Number(url.searchParams.get("valenPort")) || 43823;
      const valenUp = await checkHttpReachable(
        `http://127.0.0.1:${port}/health`,
        650
      );
      const ollamaState = await queryOllamaLifecycle();
      sendJson(req, res, 200, {
        ok: true,
        valenRunning: valenUp || valenProc !== null,
        ollamaDaemonRunning: ollamaState.daemonRunning,
        loadedOllamaModels: ollamaState.loadedModels,
        residentAiRamMb: ollamaState.residentRamMb,
        allModelsSleeping: !valenUp && ollamaState.loadedModels.length === 0,
        lastBatchCompletedIso,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/models/wake-valen") {
      const body = await readJsonBody(req);
      const result = await wakeValenOnDemand(body.port, body.ggufFile);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/models/stop-valen") {
      const result = await stopValenImmediately();
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/models/wake-ollama") {
      const result = await wakeOllamaOnDemand();
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/models/sleep-ollama") {
      const body = await readJsonBody(req);
      const valenStopped = await stopValenImmediately();
      const ollamaStopped = await unloadAndStopOllama(
        body.model ? String(body.model) : ""
      );
      sendJson(req, res, 200, {
        ok: true,
        valenStopped: valenStopped.stopped,
        ...ollamaStopped,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/collector/config") {
      const body = await readJsonBody(req);
      if (typeof body.enabled === "boolean") {
        collectorConfig.enabled = body.enabled;
      }
      if (typeof body.intervalMinutes === "number") {
        collectorConfig.intervalMinutes = Math.max(
          1,
          Math.min(60, Math.round(body.intervalMinutes))
        );
      }
      saveCollectorConfig();
      restartCollectorTimer();
      sendJson(req, res, 200, {
        ok: true,
        enabled: collectorConfig.enabled,
        intervalMinutes: collectorConfig.intervalMinutes,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/capture/enqueue") {
      const queued = await captureAndEnqueueToDisk();
      sendJson(req, res, 200, queued);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/capture/queue") {
      const includeImages = url.searchParams.get("images") !== "0";
      sendJson(req, res, 200, listDiskQueuedCaptures(includeImages));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/capture/ack") {
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const removed = acknowledgeQueuedCaptures(ids);
      sendJson(req, res, 200, { ok: true, removed });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/notify") {
      const body = await readJsonBody(req);
      const out = await runStaticJxa("notify.jxa", {
        title: String(body.title || "Dayframe").slice(0, 80),
        message: String(body.message || "").slice(0, 220),
      });
      sendJson(req, res, 200, out);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/system/open-calendar-privacy") {
      if (process.platform === "darwin") {
        execFile(
          "/usr/bin/open",
          ["x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"],
          () => {}
        );
      }
      sendJson(req, res, 200, { ok: true, hostTerminalApp: detectHostTerminalApp() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/calendar/scan") {
      const body = await readJsonBody(req);
      const startMs = Number(body.startMs) || Date.now();
      const endMs = Number(body.endMs) || startMs + 7 * 24 * 60 * 60 * 1000;
      const result = await runCalendarWaterfall("scan", {
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
      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
      ) {
        sendJson(req, res, 400, {
          ok: false,
          error: "Invalid start/end timestamps.",
        });
        return;
      }
      const result = await runCalendarWaterfall("create", {
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
      const shot = await captureMacScreenSilent();
      if (shot.bytes) delete shot.bytes;
      sendJson(req, res, 200, shot);
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
      const targetPort = allowedPorts.has(requestedPort)
        ? requestedPort
        : 43823;
      const payload =
        body.payload && typeof body.payload === "object" ? body.payload : {};

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const upstream = await fetch(
          `http://127.0.0.1:${targetPort}/v1/decisions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify(payload),
          }
        );
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
              : `Valen GGUF server sleeping on 127.0.0.1:${targetPort}`,
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

async function cleanShutdown() {
  if (collectorTimer) clearInterval(collectorTimer);
  await stopValenImmediately();
  await unloadAndStopOllama();
  process.exit(0);
}

process.on("SIGINT", () => void cleanShutdown());
process.on("SIGTERM", () => void cleanShutdown());

server.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log("\n==============================================================");
  console.log("  Dayframe Offline macOS Daemon (127.0.0.1:43822)");
  console.log("==============================================================");
  console.log("  Network Mode  : 100% Offline Loopback (0 internet calls)");
  console.log("  AI RAM Policy : Sleeping at 0 MB (wakes ONLY during batches)");
  console.log(`  Capture Queue : ${QUEUE_DIR}`);
  console.log(`  Pairing Token : ${PAIRING_TOKEN}\n`);

  if (process.argv.includes("--open") && process.platform === "darwin") {
    const uiPort = process.env.DAYFRAME_UI_PORT || "43820";
    const targetUrl = `http://127.0.0.1:${uiPort}/#pair=${PAIRING_TOKEN}`;
    execFile("/usr/bin/open", [targetUrl], () => {});
  }
});
