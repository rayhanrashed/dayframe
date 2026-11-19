#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const uiPort = process.env.PORT || "43820";
const useDevMode = process.argv.includes("--dev");

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

console.log("\n==============================================================");
console.log("  Dayframe — All-In-One Offline MacBook Launcher");
console.log("==============================================================");

// 1. One-time local node_modules check
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

// 2. Check offline model weights on disk (without leaving Ollama running in RAM!)
if (hasLocalGemma4Cached()) {
  console.log(
    "[2/3] Offline Gemma 4 weights verified on disk (staying STOPPED at 0 MB RAM until batch run)."
  );
} else {
  console.log(
    "[2/3] Checking local Gemma 4 weights (one-time setup if not yet pulled)..."
  );
  const ollamaBin = findOllamaBin();
  let tempServe = null;
  try {
    tempServe = spawn(ollamaBin, ["serve"], {
      stdio: "ignore",
      env: cleanEnv,
    });
    execFileSync(ollamaBin, ["pull", "gemma4:e4b"], {
      stdio: "inherit",
      env: cleanEnv,
    });
    console.log("      Pulled gemma4:e4b — stopping Ollama now so idle RAM stays 0 MB.");
  } catch {
    console.log(
      "      Note: Could not auto-pull gemma4:e4b right now (offline or Ollama not installed yet)."
    );
    console.log(
      "      Once Ollama is installed and gemma4:e4b is pulled once, Dayframe runs 100% offline."
    );
  } finally {
    if (tempServe) {
      try {
        tempServe.kill("SIGTERM");
      } catch {}
    }
  }
}

// 3. Build production UI bundle once so runtime uses ~45 MB RAM with zero internet
const nextBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);

if (!useDevMode && !fs.existsSync(path.join(rootDir, ".next", "BUILD_ID"))) {
  console.log("[3/3] Building compact local UI bundle (first run only)...");
  execFileSync(nextBin, ["build"], {
    cwd: rootDir,
    stdio: "inherit",
    env: cleanEnv,
  });
} else {
  console.log("[3/3] Starting loopback UI (127.0.0.1:" + uiPort + ") + Mac Daemon...");
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

setTimeout(() => {
  bridgeProc = spawn(
    process.execPath,
    [path.join(__dirname, "dayframe-mac.mjs"), "--open"],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: { ...cleanEnv, DAYFRAME_UI_PORT: uiPort },
    }
  );
}, 1400);

function shutdown() {
  if (bridgeProc) {
    try {
      bridgeProc.kill("SIGTERM");
    } catch {}
  }
  try {
    nextProc.kill("SIGTERM");
  } catch {}
  setTimeout(() => process.exit(0), 400);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
