#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const uiPort = process.env.PORT || "43820";
const args = process.argv.slice(2);
const subcommand = args[0] || "";
const useDevMode = args.includes("--dev");
const useNativeMacApp = args.includes("--app") || subcommand === "app";
const pidFile = path.join(os.homedir(), ".dayframe", "pids.json");

function ensureNativeMacAppBundle() {
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/swiftc")) {
    return null;
  }
  const swiftSrc = path.join(__dirname, "swift", "DayframeMacApp.swift");
  if (!fs.existsSync(swiftSrc)) return null;

  const appDir = path.join(rootDir, "build", "Dayframe.app", "Contents");
  const macosDir = path.join(appDir, "MacOS");
  const binPath = path.join(macosDir, "Dayframe");
  const plistPath = path.join(appDir, "Info.plist");

  fs.mkdirSync(macosDir, { recursive: true });
  if (!fs.existsSync(plistPath)) {
    fs.writeFileSync(
      plistPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Dayframe</string>
  <key>CFBundleIdentifier</key>
  <string>local.dayframe.macapp</string>
  <key>CFBundleName</key>
  <string>Dayframe</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>\n`,
      "utf8"
    );
  }

  const needBuild =
    !fs.existsSync(binPath) ||
    fs.statSync(swiftSrc).mtimeMs > fs.statSync(binPath).mtimeMs;
  if (needBuild) {
    console.log("Building native macOS Dayframe.app window & menu-bar shell...");
    execFileSync(
      "/usr/bin/swiftc",
      [
        swiftSrc,
        "-framework",
        "AppKit",
        "-framework",
        "WebKit",
        "-framework",
        "Foundation",
        "-o",
        binPath,
      ],
      { stdio: "inherit" }
    );
  }
  return binPath;
}

const cleanEnv = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  OLLAMA_NOUPDATE: "1",
  OLLAMA_HOST: "127.0.0.1:11434",
  OLLAMA_ORIGINS: "*",
};

function findOllamaBin() {
  const candidates = [
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "ollama";
}

function runQuiet(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

async function unloadAllOllamaModels() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/ps");
    if (!res.ok) return;
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    for (const m of models) {
      const name = String(m.name || m.model || "");
      if (!name) continue;
      await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, keep_alive: 0 }),
      }).catch(() => {});
    }
  } catch {
    // Ollama not running
  }
}

async function stopAllDayframeAndModels() {
  console.log("Stopping Dayframe, Gemma 4 / Ollama, and Valen background processes...");

  // 1. Unload any resident Gemma 4 / Ollama models from unified memory
  await unloadAllOllamaModels();

  // 2. Ask Mac Bridge to shut down cleanly if paired token exists
  const tokenFile = path.join(os.homedir(), ".dayframe-bridge-token");
  if (fs.existsSync(tokenFile)) {
    const tok = fs.readFileSync(tokenFile, "utf8").trim();
    await fetch("http://127.0.0.1:43822/api/system/shutdown", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    }).catch(() => {});
  }

  // 3. Kill recorded PIDs if present
  if (fs.existsSync(pidFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      for (const pid of [saved.bridgePid, saved.nextPid, saved.launcherPid]) {
        if (typeof pid === "number" && pid > 1 && pid !== process.pid) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
      }
      fs.unlinkSync(pidFile);
    } catch {}
  }

  // 4. Disable background screenshot collector flag on disk
  const collectorCfg = path.join(os.homedir(), ".dayframe", "collector-config.json");
  if (fs.existsSync(collectorCfg)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(collectorCfg, "utf8"));
      fs.writeFileSync(
        collectorCfg,
        JSON.stringify({ ...parsed, enabled: false }, null, 2),
        { mode: 0o600 }
      );
    } catch {}
  }

  // 5. Terminate any lingering orphaned processes on macOS
  if (process.platform === "darwin") {
    runQuiet("/usr/bin/pkill", ["-TERM", "-f", "macos-bridge/dayframe-mac.mjs"]);
    runQuiet("/usr/bin/pkill", ["-TERM", "-f", `next.*${uiPort}`]);
    runQuiet("/usr/bin/pkill", ["-TERM", "-f", "Valen-Decision"]);
    runQuiet("/usr/bin/pkill", ["-TERM", "-f", "ollama runner"]);
    runQuiet("/usr/bin/pkill", ["-TERM", "-f", "ollama serve"]);
    runQuiet("/opt/homebrew/bin/brew", ["services", "stop", "ollama"]);
  }

  console.log("Stopped. Dayframe, Ollama/Gemma 4, and Valen are all shut down (0 MB RAM).");
}

async function printStatus() {
  const bridgeUp = await fetch("http://127.0.0.1:43822/health")
    .then((r) => r.ok)
    .catch(() => false);
  const uiUp = await fetch(`http://127.0.0.1:${uiPort}`)
    .then((r) => r.ok)
    .catch(() => false);
  let ollamaInfo = "Stopped (0 MB RAM)";
  try {
    const ps = await fetch("http://127.0.0.1:11434/api/ps");
    if (ps.ok) {
      const data = await ps.json();
      const names = (data.models || []).map((m) => m.name).join(", ");
      ollamaInfo = names ? `Running — loaded: ${names}` : "Daemon running (0 models loaded)";
    }
  } catch {}

  console.log(`Dayframe UI (127.0.0.1:${uiPort})   : ${uiUp ? "RUNNING" : "STOPPED"}`);
  console.log(`Mac Daemon  (127.0.0.1:43822)   : ${bridgeUp ? "RUNNING" : "STOPPED"}`);
  console.log(`Ollama / Gemma (127.0.0.1:11434): ${ollamaInfo}`);
}

function hasLocalGemma4Cached() {
  const manifestDir = path.join(
    os.homedir(),
    ".ollama",
    "models",
    "manifests",
    "registry.ollama.ai",
    "library",
    "gemma4"
  );
  return fs.existsSync(manifestDir);
}

function getCurrentGitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "local";
  }
}

async function waitForOllamaReady(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("http://127.0.0.1:11434/api/tags");
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

async function main() {
  if (subcommand === "stop" || subcommand === "--stop" || subcommand === "kill") {
    await stopAllDayframeAndModels();
    process.exit(0);
  }
  if (subcommand === "status" || subcommand === "--status") {
    await printStatus();
    process.exit(0);
  }

  console.log("\n==============================================================");
  console.log("  Dayframe — All-In-One Offline MacBook Launcher");
  console.log("  (Stop anytime with Ctrl+C or `./dayframe stop`)");
  console.log("==============================================================");

  if (!fs.existsSync(path.join(rootDir, "node_modules", "next"))) {
    console.log("[1/3] Installing local dependencies (first run only)...");
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--prefer-offline", "--no-audit", "--no-fund"],
      { cwd: rootDir, stdio: "inherit", env: cleanEnv }
    );
  } else {
    console.log("[1/3] Local dependencies ready.");
  }

  if (hasLocalGemma4Cached()) {
    console.log(
      "[2/3] Offline Gemma 4 weights verified on disk (staying STOPPED at 0 MB RAM until needed)."
    );
  } else {
    console.log(
      "[2/3] Checking local Gemma 4 weights (one-time download if not yet cached)..."
    );
    const ollamaBin = findOllamaBin();
    let tempServe = null;
    try {
      const alreadyUp = await waitForOllamaReady(500);
      if (!alreadyUp) {
        tempServe = spawn(ollamaBin, ["serve"], {
          stdio: "ignore",
          env: cleanEnv,
        });
        await waitForOllamaReady(8000);
      }
      execFileSync(ollamaBin, ["pull", "gemma4:e4b"], {
        stdio: "inherit",
        env: cleanEnv,
      });
      console.log(
        "      Cached gemma4:e4b — stopping Ollama now so idle RAM stays 0 MB."
      );
    } catch {
      console.log(
        "      Note: Ollama not installed or currently offline. Install Ollama once (brew install ollama) and re-run ./dayframe."
      );
    } finally {
      if (tempServe) {
        try {
          tempServe.kill("SIGTERM");
        } catch {}
      }
    }
  }

  const nextBin = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "next.cmd" : "next"
  );
  const headSha = getCurrentGitHead();
  const stampPath = path.join(rootDir, ".next", ".dayframe-built-sha");
  const builtSha = fs.existsSync(stampPath)
    ? fs.readFileSync(stampPath, "utf8").trim()
    : "";

  if (
    !useDevMode &&
    (!fs.existsSync(path.join(rootDir, ".next", "BUILD_ID")) ||
      builtSha !== headSha)
  ) {
    console.log("[3/3] Building compact local UI bundle...");
    execFileSync(nextBin, ["build"], {
      cwd: rootDir,
      stdio: "inherit",
      env: cleanEnv,
    });
    try {
      fs.writeFileSync(stampPath, headSha, "utf8");
    } catch {}
  } else {
    console.log(
      `[3/3] Starting loopback UI (127.0.0.1:${uiPort}) + Native Mac Bridge...`
    );
  }

  const nextArgs = useDevMode
    ? ["dev", "--hostname", "127.0.0.1", "--port", uiPort]
    : ["start", "--hostname", "127.0.0.1", "--port", uiPort];

  const nextProc = spawn(nextBin, nextArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: cleanEnv,
  });

  let bridgeProc = null;
  let nativeAppProc = null;
  const nativeAppBin = useNativeMacApp ? ensureNativeMacAppBundle() : null;

  setTimeout(() => {
    const bridgeArgs = [path.join(__dirname, "dayframe-mac.mjs")];
    if (!nativeAppBin) {
      bridgeArgs.push("--open");
    }
    bridgeProc = spawn(process.execPath, bridgeArgs, {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...cleanEnv,
        DAYFRAME_UI_PORT: uiPort,
        DAYFRAME_MANAGED: "1",
      },
    });

    if (nativeAppBin) {
      setTimeout(() => {
        const tokenPath = path.join(os.homedir(), ".dayframe-bridge-token");
        const tok = fs.existsSync(tokenPath)
          ? fs.readFileSync(tokenPath, "utf8").trim()
          : "";
        const targetUrl = tok
          ? `http://127.0.0.1:${uiPort}/#pair=${tok}`
          : `http://127.0.0.1:${uiPort}`;
        nativeAppProc = spawn(nativeAppBin, [targetUrl], {
          cwd: rootDir,
          stdio: "ignore",
        });
        nativeAppProc.on("exit", () => {
          void shutdown();
        });
      }, 600);
    }

    try {
      fs.mkdirSync(path.dirname(pidFile), { recursive: true });
      fs.writeFileSync(
        pidFile,
        JSON.stringify({
          launcherPid: process.pid,
          nextPid: nextProc.pid,
          bridgePid: bridgeProc.pid,
        }),
        { mode: 0o600 }
      );
    } catch {}
  }, 1400);

  let exiting = false;
  async function shutdown() {
    if (exiting) return;
    exiting = true;
    await unloadAllOllamaModels();
    if (nativeAppProc) {
      try {
        nativeAppProc.kill("SIGTERM");
      } catch {}
    }
    if (bridgeProc) {
      try {
        bridgeProc.kill("SIGTERM");
      } catch {}
    }
    try {
      nextProc.kill("SIGTERM");
    } catch {}
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}
    setTimeout(() => process.exit(0), 2200);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());
}

void main();
