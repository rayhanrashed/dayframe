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
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

async function main() {
  console.log("\n==============================================================");
  console.log("  Dayframe — All-In-One Offline MacBook Launcher");
  console.log("==============================================================");

  // 1. Auto-install npm dependencies if node_modules is missing
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

  // 2. Verify local Gemma 4 weights on disk (then keep Ollama STOPPED at 0 MB RAM!)
  if (hasLocalGemma4Cached()) {
    console.log(
      "[2/3] Offline Gemma 4 weights verified on disk (staying STOPPED at 0 MB RAM until batch run)."
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

  // 3. Build production UI bundle whenever git HEAD changed (fast ~1.5s Turbopack build)
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
}

void main();
